import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import buildConfig from '../tsdown.config.js';

describe('build configuration', () => {
  it('emits the .js and .d.ts files declared by package exports', () => {
    expect(buildConfig).toMatchObject({ fixedExtension: false });
  });

  it('presents an installable demo and three concrete prompts above the fold', () => {
    const readme = readFileSync('README.md', 'utf8').slice(0, 2_500);

    expect(readme).toContain('docs/assets/umami-mcp-demo.gif');
    expect(readme).toContain('npx -y @obsidiancorps/umami-mcp');
    expect(readme).toContain('Compare website traffic with last month.');
    expect(readme).toContain('Which sources generated the most conversions?');
    expect(readme).toContain('Find pages with poor Web Vitals.');
  });

  it('documents Cloud and self-hosted authentication in registry metadata', () => {
    const manifest = JSON.parse(readFileSync('server.json', 'utf8')) as {
      packages: Array<{ environmentVariables: Array<{ name: string; isRequired: boolean }> }>;
    };
    const variables = manifest.packages[0]?.environmentVariables ?? [];
    const names = variables.map(({ name }) => name);

    expect(names).toContain('UMAMI_API_KEY');
    expect(names).toContain('UMAMI_BASE_URL');
    expect(names).toContain('UMAMI_TOKEN');
    expect(names).toContain('UMAMI_USERNAME');
    expect(names).toContain('UMAMI_PASSWORD');
    expect(names).toContain('UMAMI_TWO_FACTOR_SECRET');
    expect(variables.every(({ isRequired }) => isRequired === false)).toBe(true);
  });

  it('ships automated container and MCP Registry publication workflows', () => {
    expect(existsSync('.github/workflows/container.yml')).toBe(true);

    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(releaseWorkflow).toContain('mcp-publisher login github-oidc');
    expect(releaseWorkflow).toContain('mcp-publisher publish');
  });
});
