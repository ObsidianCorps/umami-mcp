import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { createUmamiServer } from '../src/server.js';
import type { RequestOptions } from '../src/umami/client.js';
import type { UmamiApi } from '../src/umami/types.js';

interface ApiCall {
  options: RequestOptions | undefined;
  path: string;
}

function recordingApi(responses: Record<string, unknown> = {}): {
  api: UmamiApi;
  calls: ApiCall[];
} {
  const calls: ApiCall[] = [];
  return {
    calls,
    api: {
      request(path, options) {
        calls.push({ path, options });
        return Promise.resolve(responses[path] ?? { path });
      },
    },
  };
}

const clients: Client[] = [];
const servers: ReturnType<typeof createUmamiServer>[] = [];

async function connect(
  api: UmamiApi,
  defaultWebsiteId?: string,
  permissions: { writeTools?: boolean; destructiveTools?: boolean } = {},
): Promise<Client> {
  const server = createUmamiServer({
    api,
    defaultWebsiteId,
    writeTools: permissions.writeTools,
    destructiveTools: permissions.destructiveTools,
    now: () => new Date('2026-09-03T10:00:00.000Z'),
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  servers.push(server);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('Umami MCP server', () => {
  it('advertises a compact, read-only Umami v3 toolset', async () => {
    const { api } = recordingApi();
    const client = await connect(api, 'website-id');

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      'umami_check_connection',
      'umami_list_websites',
      'umami_get_website',
      'umami_get_overview',
      'umami_get_metrics',
      'umami_get_realtime',
      'umami_list_sessions',
      'umami_inspect_session',
      'umami_query_session_data',
      'umami_list_events',
      'umami_query_event_data',
      'umami_get_revenue',
      'umami_list_replays',
      'umami_run_report',
      'umami_list_reports',
      'umami_list_segments',
      'umami_list_assets',
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
    const reportTool = tools.find((tool) => tool.name === 'umami_run_report');
    const parametersSchema = (
      reportTool?.inputSchema.properties as Record<string, { description?: string }>
    ).parameters;
    expect(parametersSchema?.description).toContain('funnel');
    expect(parametersSchema?.description).toContain('heatmap');
  });

  it('registers mutation tools only when explicitly enabled', async () => {
    const { api } = recordingApi();
    const writeClient = await connect(api, 'site-id', { writeTools: true });

    const writeTools = (await writeClient.listTools()).tools;
    expect(writeTools.slice(17).map((tool) => tool.name)).toEqual([
      'umami_manage_website',
      'umami_manage_segment',
      'umami_manage_report',
      'umami_manage_asset',
      'umami_send_event',
    ]);
    expect(writeTools.slice(17).every((tool) => tool.annotations?.readOnlyHint === false)).toBe(
      true,
    );
    expect(writeTools.some((tool) => tool.annotations?.destructiveHint === true)).toBe(false);

    const destructiveClient = await connect(api, 'site-id', {
      writeTools: true,
      destructiveTools: true,
    });
    const destructiveTools = (await destructiveClient.listTools()).tools;
    expect(destructiveTools.slice(22).map((tool) => tool.name)).toEqual([
      'umami_delete_website_data',
      'umami_delete_entity',
    ]);
    expect(
      destructiveTools.slice(22).every((tool) => tool.annotations?.destructiveHint === true),
    ).toBe(true);
  });

  it('maps opt-in mutations to typed Umami v3 write routes', async () => {
    const { api, calls } = recordingApi();
    const client = await connect(api, 'site-id', { writeTools: true });

    await client.callTool({
      name: 'umami_manage_website',
      arguments: {
        operation: 'update',
        website: '7ae1ba4a-5a51-4bb3-9055-08036bda66d9',
        values: {
          name: 'Product analytics',
          replayConfig: { replayEnabled: true, sampleRate: 0.25, maskLevel: 'strict' },
        },
      },
    });
    await client.callTool({
      name: 'umami_manage_segment',
      arguments: {
        operation: 'create',
        type: 'segment',
        name: 'Customers',
        parameters: { filters: [{ name: 'event', operator: 'eq', value: 'purchase' }] },
      },
    });
    await client.callTool({
      name: 'umami_send_event',
      arguments: {
        type: 'event',
        payload: { name: 'mcp-test', url: '/test', data: { source: 'mcp' } },
      },
    });

    expect(calls).toEqual([
      {
        path: '/websites/7ae1ba4a-5a51-4bb3-9055-08036bda66d9',
        options: {
          method: 'POST',
          body: {
            name: 'Product analytics',
            replayConfig: { replayEnabled: true, sampleRate: 0.25, maskLevel: 'strict' },
          },
        },
      },
      {
        path: '/websites/site-id/segments',
        options: {
          method: 'POST',
          body: {
            type: 'segment',
            name: 'Customers',
            parameters: { filters: [{ name: 'event', operator: 'eq', value: 'purchase' }] },
          },
        },
      },
      {
        path: '/send',
        options: {
          method: 'POST',
          body: {
            type: 'event',
            payload: {
              website: 'site-id',
              name: 'mcp-test',
              url: '/test',
              data: { source: 'mcp' },
            },
          },
        },
      },
    ]);
  });

  it('requires exact, target-specific confirmation for destructive operations', async () => {
    const { api, calls } = recordingApi();
    const client = await connect(api, 'site-id', {
      writeTools: true,
      destructiveTools: true,
    });

    const rejected = await client.callTool({
      name: 'umami_delete_website_data',
      arguments: { action: 'reset', confirm: 'yes' },
    });
    expect(rejected.isError).toBe(true);
    expect(calls).toEqual([]);

    const accepted = await client.callTool({
      name: 'umami_delete_website_data',
      arguments: { action: 'reset', confirm: 'RESET site-id' },
    });
    expect(accepted.isError).not.toBe(true);
    expect(calls).toEqual([{ path: '/websites/site-id/reset', options: { method: 'POST' } }]);
  });

  it('returns structured output and normalizes a model-friendly overview request', async () => {
    const { api, calls } = recordingApi({
      '/websites/7ae1ba4a-5a51-4bb3-9055-08036bda66d9/stats': { visitors: 10 },
      '/websites/7ae1ba4a-5a51-4bb3-9055-08036bda66d9/metrics': [{ x: '/docs', y: 5 }],
    });
    const client = await connect(api);

    const result = await client.callTool({
      name: 'umami_get_overview',
      arguments: {
        website: '7ae1ba4a-5a51-4bb3-9055-08036bda66d9',
        period: 'last_7_days',
        includePageviews: false,
        metricTypes: ['path'],
        limit: 5,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      data: {
        websiteId: '7ae1ba4a-5a51-4bb3-9055-08036bda66d9',
        range: {
          startAt: Date.parse('2026-08-27T10:00:00.000Z'),
          endAt: Date.parse('2026-09-03T10:00:00.000Z'),
        },
        stats: { visitors: 10 },
        metrics: { path: [{ x: '/docs', y: 5 }] },
      },
      meta: { targetUmamiVersion: '3.3.1' },
    });
    expect(calls).toEqual([
      {
        path: '/websites/7ae1ba4a-5a51-4bb3-9055-08036bda66d9/stats',
        options: {
          query: {
            startAt: Date.parse('2026-08-27T10:00:00.000Z'),
            endAt: Date.parse('2026-09-03T10:00:00.000Z'),
            timezone: 'UTC',
          },
        },
      },
      {
        path: '/websites/7ae1ba4a-5a51-4bb3-9055-08036bda66d9/metrics',
        options: {
          query: {
            startAt: Date.parse('2026-08-27T10:00:00.000Z'),
            endAt: Date.parse('2026-09-03T10:00:00.000Z'),
            timezone: 'UTC',
            type: 'path',
            limit: 5,
          },
        },
      },
    ]);
  });

  it('maps session and event property exploration to current v3 routes', async () => {
    const { api, calls } = recordingApi();
    const client = await connect(api, 'site-id');

    await client.callTool({
      name: 'umami_query_session_data',
      arguments: {
        operation: 'values',
        propertyName: 'plan',
        dataType: 1,
        period: 'last_30_days',
      },
    });
    await client.callTool({
      name: 'umami_query_event_data',
      arguments: {
        operation: 'pivot',
        eventName: 'signup',
        period: 'today',
        timezone: 'Europe/Luxembourg',
        page: 2,
        pageSize: 25,
      },
    });

    expect(calls[0]).toMatchObject({
      path: '/websites/site-id/session-data/values',
      options: { query: { propertyName: 'plan', dataType: 1 } },
    });
    expect(calls[1]).toEqual({
      path: '/websites/site-id/event-data-pivot',
      options: {
        query: {
          startAt: Date.parse('2026-09-02T22:00:00.000Z'),
          endAt: Date.parse('2026-09-03T10:00:00.000Z'),
          timezone: 'Europe/Luxembourg',
          eventName: 'signup',
          page: 2,
          pageSize: 25,
        },
      },
    });
  });

  it('exposes current session aggregates and event time-series routes', async () => {
    const { api, calls } = recordingApi();
    const client = await connect(api, 'site-id');

    await client.callTool({
      name: 'umami_query_session_data',
      arguments: { operation: 'session_stats', period: 'last_7_days' },
    });
    await client.callTool({
      name: 'umami_query_event_data',
      arguments: { operation: 'event_stats', period: 'last_7_days' },
    });
    await client.callTool({
      name: 'umami_query_event_data',
      arguments: { operation: 'series', eventName: 'signup', period: 'last_7_days' },
    });

    expect(calls.map((call) => call.path)).toEqual([
      '/websites/site-id/sessions/stats',
      '/websites/site-id/events/stats',
      '/websites/site-id/events/series',
    ]);
  });

  it('rejects property operations missing the property they require', async () => {
    const { api, calls } = recordingApi();
    const client = await connect(api, 'site-id');

    const result = await client.callTool({
      name: 'umami_query_session_data',
      arguments: { operation: 'values', period: 'last_7_days' },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'The values operation requires propertyName' },
    ]);
    expect(calls).toEqual([]);
  });

  it('serializes repeated property filters in Umami v3 format', async () => {
    const { api, calls } = recordingApi();
    const client = await connect(api, 'site-id');

    await client.callTool({
      name: 'umami_query_session_data',
      arguments: {
        operation: 'pivot',
        propertyName: 'plan',
        period: 'last_7_days',
        propertyFilters: [
          { propertyName: 'account plan', dataType: 1, operator: 'eq', value: 'pro' },
          { propertyName: 'account plan', dataType: 1, operator: 'neq', value: 'trial' },
          { propertyName: 'region', dataType: 1, operator: 'eq', value: 'EU' },
        ],
      },
    });

    expect(calls[0]?.options?.query).toMatchObject({
      'pf_account plan': '1.eq.pro',
      'pf_account plan1': '1.neq.trial',
      pf_region: '1.eq.EU',
    });
  });

  it('covers Umami v3 revenue, replay, heatmap, segments, and board routes', async () => {
    const { api, calls } = recordingApi();
    const client = await connect(api, 'site-id');

    await client.callTool({
      name: 'umami_get_revenue',
      arguments: { currency: 'EUR', sections: ['stats'], period: 'last_7_days' },
    });
    await client.callTool({
      name: 'umami_list_replays',
      arguments: { period: 'last_7_days', minDuration: 30 },
    });
    await client.callTool({
      name: 'umami_run_report',
      arguments: {
        type: 'heatmap',
        period: 'today',
        parameters: { urlPath: '/pricing', mode: 'click' },
      },
    });
    await client.callTool({ name: 'umami_list_segments', arguments: {} });
    await client.callTool({
      name: 'umami_list_assets',
      arguments: { kind: 'boards', pageSize: 10 },
    });

    expect(calls.map((call) => call.path)).toEqual([
      '/websites/site-id/revenue/stats',
      '/websites/site-id/replays',
      '/reports/heatmap',
      '/websites/site-id/segments',
      '/boards',
    ]);
    expect(calls[2]?.options).toEqual({
      method: 'POST',
      body: {
        websiteId: 'site-id',
        type: 'heatmap',
        filters: {},
        parameters: {
          startDate: '2026-09-03T00:00:00.000Z',
          endDate: '2026-09-03T10:00:00.000Z',
          urlPath: '/pricing',
          mode: 'click',
        },
      },
    });
  });

  it('turns upstream failures into model-readable tool errors', async () => {
    const client = await connect({
      request() {
        return Promise.reject(new Error('Umami is unavailable'));
      },
    });

    const result = await client.callTool({
      name: 'umami_list_websites',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Umami is unavailable' }]);
  });

  it('publishes useful capabilities and website resources', async () => {
    const { api, calls } = recordingApi({
      '/websites': [{ id: 'site-id', name: 'Product' }],
    });
    const client = await connect(api);

    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      'umami://capabilities',
      'umami://websites',
    ]);

    const capabilities = await client.readResource({ uri: 'umami://capabilities' });
    expect(capabilities.contents[0]).toMatchObject({
      uri: 'umami://capabilities',
      mimeType: 'application/json',
    });
    const capabilitiesContent = capabilities.contents[0];
    expect(capabilitiesContent && 'text' in capabilitiesContent).toBe(true);
    expect(
      JSON.parse(
        capabilitiesContent && 'text' in capabilitiesContent ? capabilitiesContent.text : '',
      ),
    ).toMatchObject({
      targetUmamiVersion: '3.3.1',
      defaultMode: 'read-only',
    });

    const websites = await client.readResource({ uri: 'umami://websites' });
    const websitesContent = websites.contents[0];
    expect(websitesContent && 'text' in websitesContent).toBe(true);
    expect(
      JSON.parse(websitesContent && 'text' in websitesContent ? websitesContent.text : ''),
    ).toEqual([{ id: 'site-id', name: 'Product' }]);
    expect(calls).toEqual([{ path: '/websites', options: { query: { includeTeams: true } } }]);
  });

  it('offers reusable analytics prompts without baking in credentials or IDs', async () => {
    const { api } = recordingApi();
    const client = await connect(api);

    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      'analytics-review',
      'conversion-review',
      'realtime-triage',
    ]);

    const prompt = await client.getPrompt({
      name: 'analytics-review',
      arguments: { website: 'Product', period: 'last_30_days' },
    });
    const content = prompt.messages[0]?.content;
    expect(content?.type).toBe('text');
    if (content?.type !== 'text') throw new Error('Expected a text prompt');
    expect(content.text).toContain('Product');
    expect(content.text).toContain('umami_get_overview');
  });
});
