import type { UmamiApi, WebsiteSummary } from './types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function websitesFrom(response: unknown): WebsiteSummary[] {
  const candidates: unknown[] = Array.isArray(response)
    ? response
    : response && typeof response === 'object' && 'data' in response && Array.isArray(response.data)
      ? response.data
      : [];

  return candidates.flatMap((candidate): WebsiteSummary[] => {
    if (!candidate || typeof candidate !== 'object' || !('id' in candidate)) return [];
    if (typeof candidate.id !== 'string' || !candidate.id) return [];
    return [
      {
        id: candidate.id,
        name:
          'name' in candidate && typeof candidate.name === 'string' ? candidate.name : undefined,
        domain:
          'domain' in candidate && typeof candidate.domain === 'string'
            ? candidate.domain
            : undefined,
      },
    ];
  });
}

function choices(websites: WebsiteSummary[]): string {
  return websites
    .map((website) => {
      const name = website.name ?? 'Unnamed website';
      return `${name} (${[website.domain, website.id].filter(Boolean).join(', ')})`;
    })
    .join('; ');
}

export async function resolveWebsiteId(
  selector: string | undefined,
  defaultWebsiteId: string | undefined,
  api: UmamiApi,
): Promise<string> {
  if (selector && UUID_PATTERN.test(selector)) return selector;
  if (!selector && defaultWebsiteId) return defaultWebsiteId;

  const response = await api.request('/websites', {
    query: { includeTeams: true, pageSize: 100 },
  });
  const websites = websitesFrom(response);

  if (selector) {
    const normalized = selector.toLocaleLowerCase();
    const matches = websites.filter((website) =>
      [website.id, website.name, website.domain].some(
        (candidate) => candidate?.toLocaleLowerCase() === normalized,
      ),
    );
    if (matches.length === 1) return matches[0]!.id;
    if (matches.length > 1) {
      throw new Error(`Website selector is ambiguous. Matches: ${choices(matches)}`);
    }
    throw new Error(
      `No website matched "${selector}".${websites.length ? ` Available: ${choices(websites)}` : ''}`,
    );
  }

  if (websites.length === 1) return websites[0]!.id;
  if (websites.length === 0) {
    throw new Error('No accessible Umami websites were found');
  }
  throw new Error(
    `Choose a website by ID, name, or domain, or set UMAMI_DEFAULT_WEBSITE_ID. Available: ${choices(websites)}`,
  );
}
