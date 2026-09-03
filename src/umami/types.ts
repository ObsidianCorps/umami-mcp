import type { RequestOptions } from './client.js';

export interface UmamiApi {
  request(path: string, options?: RequestOptions): Promise<unknown>;
}

export interface WebsiteSummary {
  domain?: string | undefined;
  id: string;
  name?: string | undefined;
}
