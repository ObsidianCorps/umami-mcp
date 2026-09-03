import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { Query } from './umami/client.js';
import { resolveTimeRange, type TimeRangeInput } from './umami/time-range.js';
import type { UmamiApi } from './umami/types.js';
import { resolveWebsiteId } from './umami/website-resolver.js';

const SERVER_NAME = '@obsidiancorps/umami-mcp';
const SERVER_VERSION = '0.1.1';
const TARGET_UMAMI_VERSION = '3.3.1';

const outputSchema = z.object({
  data: z.unknown(),
  meta: z.object({ targetUmamiVersion: z.literal(TARGET_UMAMI_VERSION) }),
});

const timePeriodSchema = z.enum([
  'last_24_hours',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
]);

const timestampSchema = z
  .union([z.number(), z.iso.datetime({ offset: true })])
  .describe('Epoch milliseconds or an ISO 8601 timestamp with an offset');

const timeShape = {
  startAt: timestampSchema.optional(),
  endAt: timestampSchema.optional(),
  period: timePeriodSchema.optional().describe('Convenient rolling or calendar time period'),
  timezone: z.string().default('UTC').describe('IANA timezone for calendar periods and charts'),
};

const websiteShape = {
  website: z
    .string()
    .optional()
    .describe('Website UUID, exact name, or exact domain; omit to use the configured/default site'),
};

const filtersSchema = z
  .object({
    path: z.string().optional(),
    referrer: z.string().optional(),
    title: z.string().optional(),
    query: z.string().optional(),
    os: z.string().optional(),
    browser: z.string().optional(),
    device: z.string().optional(),
    country: z.string().optional(),
    region: z.string().optional(),
    city: z.string().optional(),
    tag: z.string().optional(),
    hostname: z.string().optional(),
    distinctId: z.string().optional(),
    language: z.string().optional(),
    event: z.string().optional(),
    utmSource: z.string().optional(),
    utmMedium: z.string().optional(),
    utmCampaign: z.string().optional(),
    utmContent: z.string().optional(),
    utmTerm: z.string().optional(),
    segment: z.uuid().optional(),
    cohort: z.uuid().optional(),
    excludeBounce: z.string().optional(),
    match: z.enum(['all', 'any']).optional(),
  })
  .optional()
  .describe('Umami v3 visitor, traffic, campaign, segment, and cohort filters');

const pagingShape = {
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
  search: z.string().optional(),
};

const unitSchema = z.enum(['minute', 'hour', 'day', 'month', 'year']);
const metricTypeSchema = z.enum([
  'path',
  'fullPath',
  'entry',
  'exit',
  'referrer',
  'domain',
  'title',
  'query',
  'event',
  'tag',
  'hostname',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'browser',
  'os',
  'device',
  'screen',
  'language',
  'country',
  'city',
  'region',
  'distinctId',
  'channel',
]);

const propertyFilterSchema = z.object({
  propertyName: z.string().min(1),
  dataType: z.number().int().min(1).max(5).default(1),
  operator: z
    .enum([
      'eq',
      'neq',
      's',
      'ns',
      'c',
      'dnc',
      're',
      'nre',
      't',
      'f',
      'gt',
      'lt',
      'gte',
      'lte',
      'bf',
      'af',
    ])
    .default('eq'),
  value: z.string(),
});

type ToolHandler<T> = (args: T) => Promise<unknown>;

function response(data: unknown) {
  const structuredContent = {
    data: data ?? null,
    meta: { targetUmamiVersion: TARGET_UMAMI_VERSION as typeof TARGET_UMAMI_VERSION },
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function failure(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function registerReadTool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: z.ZodObject<T>,
  handler: ToolHandler<z.output<z.ZodObject<T>>>,
): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return response(await handler(args));
      } catch (cause) {
        return failure(cause);
      }
    },
  );
}

function registerMutationTool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: z.ZodObject<T>,
  handler: ToolHandler<z.output<z.ZodObject<T>>>,
  destructive = false,
): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: destructive,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return response(await handler(args));
      } catch (cause) {
        return failure(cause);
      }
    },
  );
}

function timeQuery(
  args: TimeRangeInput & {
    filters?: Record<string, string | undefined> | undefined;
    compare?: string | undefined;
  },
  now: () => Date,
): Query {
  const range = resolveTimeRange(args, now());
  return {
    ...range,
    timezone: args.timezone ?? 'UTC',
    compare: args.compare,
    ...args.filters,
  };
}

function serializePropertyFilters(
  filters: Array<z.output<typeof propertyFilterSchema>> | undefined,
): Query {
  const counts = new Map<string, number>();
  return Object.fromEntries(
    (filters ?? []).map((filter) => {
      const index = counts.get(filter.propertyName) ?? 0;
      counts.set(filter.propertyName, index + 1);
      return [
        `pf_${filter.propertyName}${index || ''}`,
        `${filter.dataType}.${filter.operator}.${filter.value}`,
      ];
    }),
  );
}

export interface CreateUmamiServerOptions {
  api: UmamiApi;
  defaultWebsiteId?: string | undefined;
  destructiveTools?: boolean | undefined;
  now?: (() => Date) | undefined;
  writeTools?: boolean | undefined;
}

export function createUmamiServer(options: CreateUmamiServerOptions): McpServer {
  const { api, defaultWebsiteId, destructiveTools = false, writeTools = false } = options;
  if (destructiveTools && !writeTools) {
    throw new Error('Destructive tools require write tools to be enabled');
  }
  const now = options.now ?? (() => new Date());
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const websiteId = (selector: string | undefined) =>
    resolveWebsiteId(selector, defaultWebsiteId, api);

  registerReadTool(
    server,
    'umami_check_connection',
    'Check Umami connection',
    'Verify authentication and return the current Umami account.',
    z.object({}),
    () => api.request('/me'),
  );

  registerReadTool(
    server,
    'umami_list_websites',
    'List websites',
    'List websites available to the authenticated Umami account, including team websites.',
    z.object({
      ...pagingShape,
      includeTeams: z.boolean().default(true),
      orderBy: z.string().optional(),
      sortDescending: z.boolean().optional(),
    }),
    (args) => api.request('/websites', { query: args }),
  );

  registerReadTool(
    server,
    'umami_get_website',
    'Get website',
    'Get configuration and metadata for one website.',
    z.object(websiteShape),
    async (args) => api.request(`/websites/${await websiteId(args.website)}`),
  );

  registerReadTool(
    server,
    'umami_get_overview',
    'Get analytics overview',
    'Get aggregate statistics, pageview series, and selected top dimensions in one efficient analytics call.',
    z.object({
      ...websiteShape,
      ...timeShape,
      filters: filtersSchema,
      compare: z.enum(['prev', 'yoy']).optional(),
      includePageviews: z.boolean().default(true),
      unit: unitSchema.optional(),
      metricTypes: z.array(metricTypeSchema).max(8).default(['path', 'referrer', 'country']),
      limit: z.number().int().positive().max(100).default(10),
    }),
    async (args) => {
      const id = await websiteId(args.website);
      const query = timeQuery(args, now);
      const statsPromise = api.request(`/websites/${id}/stats`, { query });
      const pageviewsPromise = args.includePageviews
        ? api.request(`/websites/${id}/pageviews`, {
            query: { ...query, unit: args.unit },
          })
        : undefined;
      const metricEntriesPromise = Promise.all(
        args.metricTypes.map(
          async (type) =>
            [
              type,
              await api.request(`/websites/${id}/metrics`, {
                query: { ...query, type, limit: args.limit },
              }),
            ] as const,
        ),
      );
      const [stats, pageviews, metricEntries] = await Promise.all([
        statsPromise,
        pageviewsPromise,
        metricEntriesPromise,
      ]);
      return {
        websiteId: id,
        range: { startAt: query.startAt, endAt: query.endAt },
        stats,
        ...(pageviewsPromise ? { pageviews } : {}),
        metrics: Object.fromEntries(metricEntries),
      };
    },
  );

  registerReadTool(
    server,
    'umami_get_metrics',
    'Get metric breakdown',
    'Rank a traffic, campaign, technology, geography, event, or visitor dimension.',
    z.object({
      ...websiteShape,
      ...timeShape,
      filters: filtersSchema,
      type: metricTypeSchema,
      limit: z.number().int().positive().max(1000).default(20),
      offset: z.number().int().nonnegative().optional(),
      search: z.string().optional(),
    }),
    async (args) => {
      const id = await websiteId(args.website);
      return api.request(`/websites/${id}/metrics`, {
        query: {
          ...timeQuery(args, now),
          type: args.type,
          limit: args.limit,
          offset: args.offset,
          search: args.search,
        },
      });
    },
  );

  registerReadTool(
    server,
    'umami_get_realtime',
    'Get realtime analytics',
    'Get Umami realtime activity for the last 30 minutes.',
    z.object({ ...websiteShape, timezone: z.string().default('UTC'), filters: filtersSchema }),
    async (args) =>
      api.request(`/realtime/${await websiteId(args.website)}`, {
        query: { timezone: args.timezone, ...args.filters },
      }),
  );

  registerReadTool(
    server,
    'umami_list_sessions',
    'List sessions',
    'List visitor sessions with geography, technology, engagement, campaign, segment, and property filters.',
    z.object({
      ...websiteShape,
      ...timeShape,
      ...pagingShape,
      filters: filtersSchema,
    }),
    async (args) =>
      api.request(`/websites/${await websiteId(args.website)}/sessions`, {
        query: {
          ...timeQuery(args, now),
          page: args.page,
          pageSize: args.pageSize,
          search: args.search,
        },
      }),
  );

  registerReadTool(
    server,
    'umami_inspect_session',
    'Inspect session',
    'Return session details plus selected activity, properties, and replay metadata.',
    z.object({
      ...websiteShape,
      ...timeShape,
      sessionId: z.string().min(1),
      include: z
        .array(z.enum(['activity', 'properties', 'replays']))
        .default(['activity', 'properties', 'replays']),
    }),
    async (args) => {
      const id = await websiteId(args.website);
      const base = `/websites/${id}/sessions/${encodeURIComponent(args.sessionId)}`;
      const range = timeQuery(args, now);
      const details = api.request(base);
      const extras = await Promise.all(
        args.include.map(
          async (section) =>
            [
              section,
              await api.request(
                `${base}/${section}`,
                section === 'activity' ? { query: range } : {},
              ),
            ] as const,
        ),
      );
      return { details: await details, ...Object.fromEntries(extras) };
    },
  );

  registerReadTool(
    server,
    'umami_query_session_data',
    'Query session properties',
    'Explore Umami v3 session properties, pivots, statistics, and typed series.',
    z.object({
      ...websiteShape,
      ...timeShape,
      ...pagingShape,
      filters: filtersSchema,
      propertyFilters: z.array(propertyFilterSchema).max(20).optional(),
      operation: z.enum([
        'session_stats',
        'weekly',
        'properties',
        'values',
        'stats',
        'pivot',
        'numeric_stats',
        'numeric_series',
        'date_series',
        'property_series',
        'array_series',
      ]),
      propertyName: z.string().optional(),
      dataType: z.number().int().min(1).max(5).optional(),
      unit: unitSchema.optional(),
    }),
    async (args) => {
      const propertyOperations = new Set([
        'values',
        'stats',
        'pivot',
        'numeric_stats',
        'numeric_series',
        'date_series',
        'property_series',
        'array_series',
      ]);
      if (propertyOperations.has(args.operation) && !args.propertyName) {
        throw new Error(`The ${args.operation} operation requires propertyName`);
      }
      const id = await websiteId(args.website);
      const paths = {
        session_stats: 'sessions/stats',
        weekly: 'sessions/weekly',
        properties: 'session-data/properties',
        values: 'session-data/values',
        stats: 'session-data/stats',
        pivot: 'session-data-pivot',
        numeric_stats: 'session-data/numeric-stats',
        numeric_series: 'session-data/numeric-series',
        date_series: 'session-data/date-series',
        property_series: 'session-data/property-series',
        array_series: 'session-data/array-series',
      } as const;
      return api.request(`/websites/${id}/${paths[args.operation]}`, {
        query: {
          ...timeQuery(args, now),
          ...serializePropertyFilters(args.propertyFilters),
          propertyName: args.propertyName,
          dataType: args.dataType,
          unit: args.unit,
          page: args.page,
          pageSize: args.pageSize,
          search: args.search,
        },
      });
    },
  );

  registerReadTool(
    server,
    'umami_list_events',
    'List events',
    'List pageviews and custom events for a website in a time range.',
    z.object({ ...websiteShape, ...timeShape, ...pagingShape, filters: filtersSchema }),
    async (args) =>
      api.request(`/websites/${await websiteId(args.website)}/events`, {
        query: {
          ...timeQuery(args, now),
          page: args.page,
          pageSize: args.pageSize,
          search: args.search,
        },
      }),
  );

  registerReadTool(
    server,
    'umami_query_event_data',
    'Query event data',
    'Explore Umami v3 event properties, values, pivots, statistics, and typed series.',
    z.object({
      ...websiteShape,
      ...timeShape,
      ...pagingShape,
      filters: filtersSchema,
      propertyFilters: z.array(propertyFilterSchema).max(20).optional(),
      operation: z.enum([
        'event_stats',
        'series',
        'events',
        'fields',
        'properties',
        'values',
        'stats',
        'pivot',
        'numeric_stats',
        'numeric_series',
        'date_series',
        'property_series',
        'array_series',
      ]),
      eventName: z.string().optional(),
      propertyName: z.string().optional(),
      dataType: z.number().int().min(1).max(5).optional(),
      unit: unitSchema.optional(),
    }),
    async (args) => {
      const propertyOperations = new Set([
        'values',
        'numeric_stats',
        'numeric_series',
        'date_series',
        'property_series',
        'array_series',
      ]);
      if (propertyOperations.has(args.operation) && !args.propertyName) {
        throw new Error(`The ${args.operation} operation requires propertyName`);
      }
      const eventOperations = new Set([
        'pivot',
        'numeric_stats',
        'numeric_series',
        'date_series',
        'property_series',
        'array_series',
      ]);
      if (eventOperations.has(args.operation) && !args.eventName) {
        throw new Error(`The ${args.operation} operation requires eventName`);
      }
      const id = await websiteId(args.website);
      const paths = {
        event_stats: 'events/stats',
        series: 'events/series',
        events: 'event-data/events',
        fields: 'event-data/fields',
        properties: 'event-data/properties',
        values: 'event-data/values',
        stats: 'event-data/stats',
        pivot: 'event-data-pivot',
        numeric_stats: 'event-data-pivot/numeric-stats',
        numeric_series: 'event-data-pivot/numeric-series',
        date_series: 'event-data-pivot/date-series',
        property_series: 'event-data-pivot/property-series',
        array_series: 'event-data-pivot/array-series',
      } as const;
      return api.request(`/websites/${id}/${paths[args.operation]}`, {
        query: {
          ...timeQuery(args, now),
          ...serializePropertyFilters(args.propertyFilters),
          event: ['events', 'series'].includes(args.operation) ? args.eventName : undefined,
          eventName: ['events', 'series'].includes(args.operation) ? undefined : args.eventName,
          propertyName: args.propertyName,
          dataType: args.dataType,
          unit: args.unit,
          page: args.page,
          pageSize: args.pageSize,
          search: args.search,
        },
      });
    },
  );

  registerReadTool(
    server,
    'umami_get_revenue',
    'Get revenue analytics',
    'Get Umami v3 revenue stats, charts, ranked dimensions, and revenue sessions.',
    z.object({
      ...websiteShape,
      ...timeShape,
      ...pagingShape,
      filters: filtersSchema,
      compare: z.enum(['prev', 'yoy']).optional(),
      currency: z.string().length(3).default('USD'),
      sections: z
        .array(z.enum(['stats', 'chart', 'country', 'region', 'referrer', 'channel', 'sessions']))
        .min(1)
        .max(7)
        .default(['stats', 'chart', 'country', 'referrer', 'channel']),
    }),
    async (args) => {
      const id = await websiteId(args.website);
      const query = {
        ...timeQuery(args, now),
        currency: args.currency.toUpperCase(),
        page: args.page,
        pageSize: args.pageSize,
        search: args.search,
      };
      const entries = await Promise.all(
        args.sections.map(async (section) => {
          const metric = ['country', 'region', 'referrer', 'channel'].includes(section);
          const path = metric ? 'metrics' : section;
          return [
            section,
            await api.request(`/websites/${id}/revenue/${path}`, {
              query: { ...query, type: metric ? section : undefined },
            }),
          ] as const;
        }),
      );
      return {
        websiteId: id,
        currency: args.currency.toUpperCase(),
        ...Object.fromEntries(entries),
      };
    },
  );

  registerReadTool(
    server,
    'umami_list_replays',
    'List or inspect session replays',
    'List Umami v3 session replays, or retrieve one replay event stream by replayId.',
    z.object({
      ...websiteShape,
      ...timeShape,
      ...pagingShape,
      filters: filtersSchema,
      replayId: z.string().optional(),
      minDuration: z.number().int().nonnegative().optional(),
      until: z.number().int().optional(),
    }),
    async (args) => {
      const id = await websiteId(args.website);
      if (args.replayId) {
        return api.request(`/websites/${id}/replays/${encodeURIComponent(args.replayId)}`, {
          query: { until: args.until },
        });
      }
      return api.request(`/websites/${id}/replays`, {
        query: {
          ...timeQuery(args, now),
          minDuration: args.minDuration,
          page: args.page,
          pageSize: args.pageSize,
          search: args.search,
        },
      });
    },
  );

  registerReadTool(
    server,
    'umami_run_report',
    'Run analytics report',
    'Run a funnel, goal, journey, retention, attribution, UTM, revenue, performance, breakdown, or heatmap report.',
    z.object({
      ...websiteShape,
      ...timeShape,
      filters: filtersSchema,
      type: z.enum([
        'attribution',
        'breakdown',
        'funnel',
        'goal',
        'heatmap',
        'journey',
        'performance',
        'retention',
        'revenue',
        'utm',
      ]),
      parameters: z
        .record(z.string(), z.unknown())
        .default({})
        .describe(
          'Report-specific fields: funnel {window, steps}; goal {type, value}; journey {steps, startStep?, endStep?}; attribution {model, type, step, currency?}; breakdown {fields}; performance {metric?, unit?}; revenue {currency, compare?, unit?}; heatmap {urlPath?, mode?}. Date range is added automatically.',
        ),
    }),
    async (args) => {
      const id = await websiteId(args.website);
      const range = resolveTimeRange(args, now());
      return api.request(`/reports/${args.type}`, {
        method: 'POST',
        body: {
          websiteId: id,
          type: args.type,
          filters: args.filters ?? {},
          parameters: {
            startDate: new Date(range.startAt).toISOString(),
            endDate: new Date(range.endAt).toISOString(),
            ...args.parameters,
          },
        },
      });
    },
  );

  registerReadTool(
    server,
    'umami_list_reports',
    'List saved reports',
    'List saved Umami reports for a website.',
    z.object({
      ...websiteShape,
      ...pagingShape,
      type: z
        .enum([
          'attribution',
          'breakdown',
          'funnel',
          'goal',
          'heatmap',
          'journey',
          'performance',
          'retention',
          'revenue',
          'utm',
        ])
        .optional(),
    }),
    async (args) =>
      api.request('/reports', {
        query: {
          websiteId: await websiteId(args.website),
          type: args.type,
          page: args.page,
          pageSize: args.pageSize,
          search: args.search,
        },
      }),
  );

  registerReadTool(
    server,
    'umami_list_segments',
    'List segments and cohorts',
    'List saved Umami v3 segments and cohorts for a website.',
    z.object({
      ...websiteShape,
      ...pagingShape,
      type: z.enum(['segment', 'cohort']).optional(),
    }),
    async (args) =>
      api.request(`/websites/${await websiteId(args.website)}/segments`, {
        query: {
          type: args.type,
          page: args.page,
          pageSize: args.pageSize,
          search: args.search,
        },
      }),
  );

  registerReadTool(
    server,
    'umami_list_assets',
    'List boards, links, or pixels',
    'List Umami v3 boards, tracked links, or tracking pixels for an account or team.',
    z.object({
      kind: z.enum(['boards', 'links', 'pixels']),
      teamId: z.string().optional(),
      ...pagingShape,
      orderBy: z.string().optional(),
      sortDescending: z.boolean().optional(),
    }),
    (args) => {
      const path = args.teamId
        ? `/teams/${encodeURIComponent(args.teamId)}/${args.kind}`
        : `/${args.kind}`;
      return api.request(path, {
        query: {
          page: args.page,
          pageSize: args.pageSize,
          search: args.search,
          orderBy: args.orderBy,
          sortDescending: args.sortDescending,
        },
      });
    },
  );

  if (writeTools) {
    const replayConfigSchema = z.object({
      replayEnabled: z.boolean().optional(),
      heatmapEnabled: z.boolean().optional(),
      sampleRate: z.number().min(0).max(1).optional(),
      heatmapSampleRate: z.number().min(0).max(1).optional(),
      maskLevel: z.enum(['strict', 'moderate']).optional(),
      maxDuration: z.number().int().positive().optional(),
      blockSelector: z.string().optional(),
    });

    registerMutationTool(
      server,
      'umami_manage_website',
      'Create or update website',
      'Create an Umami website or update its name, domain, sharing, and v3 replay/heatmap configuration.',
      z.object({
        operation: z.enum(['create', 'update']),
        website: websiteShape.website,
        values: z.object({
          name: z.string().trim().min(1).max(100).optional(),
          domain: z.string().trim().min(1).max(500).optional(),
          shareId: z.string().max(50).nullable().optional(),
          teamId: z.string().nullable().optional(),
          id: z.string().nullable().optional(),
          replayConfig: replayConfigSchema.nullable().optional(),
        }),
      }),
      async (args) => {
        if (args.operation === 'create') {
          if (!args.values.name || !args.values.domain) {
            throw new Error('Creating a website requires values.name and values.domain');
          }
          return api.request('/websites', { method: 'POST', body: args.values });
        }
        return api.request(`/websites/${await websiteId(args.website)}`, {
          method: 'POST',
          body: args.values,
        });
      },
    );

    registerMutationTool(
      server,
      'umami_manage_segment',
      'Create or update segment',
      'Create or update an Umami v3 segment or cohort.',
      z.object({
        ...websiteShape,
        operation: z.enum(['create', 'update']),
        segmentId: z.string().optional(),
        type: z.enum(['segment', 'cohort']),
        name: z.string().min(1).max(200),
        parameters: z.record(z.string(), z.unknown()),
      }),
      async (args) => {
        const id = await websiteId(args.website);
        if (args.operation === 'update' && !args.segmentId) {
          throw new Error('Updating a segment requires segmentId');
        }
        const path = args.segmentId
          ? `/websites/${id}/segments/${encodeURIComponent(args.segmentId)}`
          : `/websites/${id}/segments`;
        return api.request(path, {
          method: 'POST',
          body: { type: args.type, name: args.name, parameters: args.parameters },
        });
      },
    );

    registerMutationTool(
      server,
      'umami_manage_report',
      'Create or update saved report',
      'Create or update a saved Umami v3 analytics report.',
      z.object({
        ...websiteShape,
        operation: z.enum(['create', 'update']),
        reportId: z.string().optional(),
        type: z.enum([
          'attribution',
          'breakdown',
          'funnel',
          'goal',
          'heatmap',
          'journey',
          'performance',
          'retention',
          'revenue',
          'utm',
        ]),
        name: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
        parameters: z.record(z.string(), z.unknown()),
      }),
      async (args) => {
        if (args.operation === 'update' && !args.reportId) {
          throw new Error('Updating a report requires reportId');
        }
        const path = args.reportId ? `/reports/${encodeURIComponent(args.reportId)}` : '/reports';
        return api.request(path, {
          method: 'POST',
          body: {
            websiteId: await websiteId(args.website),
            type: args.type,
            name: args.name,
            description: args.description,
            parameters: args.parameters,
          },
        });
      },
    );

    registerMutationTool(
      server,
      'umami_manage_asset',
      'Create or update board, link, or pixel',
      'Create or update an Umami v3 board, tracked link, or tracking pixel. Values are validated by Umami for the selected kind.',
      z.object({
        kind: z.enum(['boards', 'links', 'pixels']),
        operation: z.enum(['create', 'update']),
        id: z.string().optional(),
        values: z.record(z.string(), z.unknown()),
      }),
      (args) => {
        if (args.operation === 'update' && !args.id) {
          throw new Error('Updating an asset requires id');
        }
        const path = args.id ? `/${args.kind}/${encodeURIComponent(args.id)}` : `/${args.kind}`;
        return api.request(path, { method: 'POST', body: args.values });
      },
    );

    registerMutationTool(
      server,
      'umami_send_event',
      'Send analytics event',
      'Send an event, identify payload, or Web Vitals performance sample to Umami. This changes analytics data.',
      z.object({
        ...websiteShape,
        type: z.enum(['event', 'identify', 'performance']),
        payload: z.object({
          data: z.record(z.string(), z.unknown()).optional(),
          hostname: z.string().optional(),
          language: z.string().optional(),
          referrer: z.string().optional(),
          screen: z.string().optional(),
          title: z.string().optional(),
          url: z.string().optional(),
          name: z.string().optional(),
          tag: z.string().optional(),
          timestamp: z.number().int().optional(),
          id: z.string().optional(),
          lcp: z.number().nonnegative().max(60_000).optional(),
          inp: z.number().nonnegative().max(60_000).optional(),
          cls: z.number().nonnegative().max(100).optional(),
          fcp: z.number().nonnegative().max(60_000).optional(),
          ttfb: z.number().nonnegative().max(60_000).optional(),
        }),
      }),
      async (args) =>
        api.request('/send', {
          method: 'POST',
          body: {
            type: args.type,
            payload: { website: await websiteId(args.website), ...args.payload },
          },
        }),
    );
  }

  if (destructiveTools) {
    registerMutationTool(
      server,
      'umami_delete_website_data',
      'Reset or delete website',
      'Permanently reset all analytics data or delete a website. Requires an exact target-specific confirmation string.',
      z.object({
        ...websiteShape,
        action: z.enum(['reset', 'delete']),
        confirm: z.string().describe('Must exactly equal RESET <websiteId> or DELETE <websiteId>'),
      }),
      async (args) => {
        const id = await websiteId(args.website);
        const expected = `${args.action.toUpperCase()} ${id}`;
        if (args.confirm !== expected) {
          throw new Error(`Confirmation must exactly equal: ${expected}`);
        }
        return api.request(args.action === 'reset' ? `/websites/${id}/reset` : `/websites/${id}`, {
          method: args.action === 'reset' ? 'POST' : 'DELETE',
        });
      },
      true,
    );

    registerMutationTool(
      server,
      'umami_delete_entity',
      'Delete report, segment, board, link, or pixel',
      'Permanently delete one saved report, segment/cohort, board, tracked link, or pixel. Requires exact confirmation.',
      z.object({
        ...websiteShape,
        kind: z.enum(['reports', 'segments', 'boards', 'links', 'pixels']),
        id: z.string().min(1),
        confirm: z.string().describe('Must exactly equal DELETE <kind> <id>'),
      }),
      async (args) => {
        const expected = `DELETE ${args.kind} ${args.id}`;
        if (args.confirm !== expected) {
          throw new Error(`Confirmation must exactly equal: ${expected}`);
        }
        const path =
          args.kind === 'segments'
            ? `/websites/${await websiteId(args.website)}/segments/${encodeURIComponent(args.id)}`
            : `/${args.kind}/${encodeURIComponent(args.id)}`;
        return api.request(path, { method: 'DELETE' });
      },
      true,
    );
  }

  const capabilities = {
    server: SERVER_NAME,
    version: SERVER_VERSION,
    targetUmamiVersion: TARGET_UMAMI_VERSION,
    defaultMode: destructiveTools
      ? 'read-write-destructive'
      : writeTools
        ? 'read-write'
        : 'read-only',
    transports: ['stdio', 'streamable-http'],
    domains: [
      'websites',
      'overview',
      'metrics',
      'realtime',
      'sessions',
      'session-properties',
      'events',
      'event-properties',
      'revenue',
      'session-replay',
      'reports',
      'heatmaps',
      'segments',
      'cohorts',
      'boards',
      'links',
      'pixels',
    ],
  };

  server.registerResource(
    'umami-capabilities',
    'umami://capabilities',
    {
      title: 'Umami MCP capabilities',
      description: 'Supported Umami and MCP feature baseline.',
      mimeType: 'application/json',
    },
    (uri) =>
      Promise.resolve({
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(capabilities, null, 2),
          },
        ],
      }),
  );

  server.registerResource(
    'umami-websites',
    'umami://websites',
    {
      title: 'Accessible Umami websites',
      description: 'Live list of websites the configured Umami account can access.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            await api.request('/websites', { query: { includeTeams: true } }),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerPrompt(
    'analytics-review',
    {
      title: 'Analytics review',
      description: 'Analyze traffic, engagement, acquisition, and notable changes.',
      argsSchema: z.object({
        website: z.string().default('the default website'),
        period: timePeriodSchema.default('last_30_days'),
      }),
    },
    ({ website, period }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Review Umami analytics for ${website} over ${period}. ` +
              'Start with umami_get_overview, investigate meaningful dimensions with umami_get_metrics, ' +
              'and explain findings, uncertainty, and practical next actions. Do not invent missing data.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'conversion-review',
    {
      title: 'Conversion review',
      description: 'Analyze a journey or funnel and identify likely drop-off points.',
      argsSchema: z.object({
        website: z.string().default('the default website'),
        conversion: z.string().describe('Conversion goal, event, or destination path'),
        period: timePeriodSchema.default('last_30_days'),
      }),
    },
    ({ website, conversion, period }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Analyze conversion to "${conversion}" for ${website} over ${period}. ` +
              'Use umami_run_report for a funnel or journey, then inspect events and segments where useful. ' +
              'Quantify drop-offs and distinguish evidence from hypotheses.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'realtime-triage',
    {
      title: 'Realtime traffic triage',
      description: 'Check current activity and quickly investigate unusual live traffic.',
      argsSchema: z.object({
        website: z.string().default('the default website'),
      }),
    },
    ({ website }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Triage realtime traffic for ${website}. Use umami_get_realtime, compare it with a recent ` +
              'baseline from umami_get_overview, and flag only anomalies supported by the data.',
          },
        },
      ],
    }),
  );

  return server;
}

export const serverInfo = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  targetUmamiVersion: TARGET_UMAMI_VERSION,
} as const;
