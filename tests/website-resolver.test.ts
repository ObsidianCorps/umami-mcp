import { describe, expect, it } from 'vitest';

import type { UmamiApi } from '../src/umami/types.js';
import { resolveWebsiteId } from '../src/umami/website-resolver.js';

function apiReturning(value: unknown): { api: UmamiApi; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    api: {
      request(path) {
        calls.push(path);
        return Promise.resolve(value);
      },
    },
  };
}

describe('resolveWebsiteId', () => {
  it('uses the configured default without making an API call', async () => {
    const { api, calls } = apiReturning([]);

    await expect(resolveWebsiteId(undefined, 'default-id', api)).resolves.toBe('default-id');
    expect(calls).toEqual([]);
  });

  it('uses UUID selectors directly without listing websites', async () => {
    const { api, calls } = apiReturning([]);
    const id = '7ae1ba4a-5a51-4bb3-9055-08036bda66d9';

    await expect(resolveWebsiteId(id, undefined, api)).resolves.toBe(id);
    expect(calls).toEqual([]);
  });

  it('resolves a website name or domain case-insensitively', async () => {
    const { api } = apiReturning({
      data: [
        { id: 'one', name: 'Marketing', domain: 'www.example.com' },
        { id: 'two', name: 'Product', domain: 'app.example.com' },
      ],
    });

    await expect(resolveWebsiteId('APP.EXAMPLE.COM', undefined, api)).resolves.toBe('two');
  });

  it('automatically selects the only accessible website', async () => {
    const { api } = apiReturning([{ id: 'only', name: 'Only website' }]);

    await expect(resolveWebsiteId(undefined, undefined, api)).resolves.toBe('only');
  });

  it('returns useful choices instead of guessing among multiple websites', async () => {
    const { api } = apiReturning([
      { id: 'one', name: 'Marketing', domain: 'www.example.com' },
      { id: 'two', name: 'Product', domain: 'app.example.com' },
    ]);

    await expect(resolveWebsiteId(undefined, undefined, api)).rejects.toThrow(
      /Marketing \(www\.example\.com, one\).*Product \(app\.example\.com, two\)/s,
    );
  });
});
