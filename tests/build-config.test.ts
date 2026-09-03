import { describe, expect, it } from 'vitest';

import buildConfig from '../tsdown.config.js';

describe('build configuration', () => {
  it('emits the .js and .d.ts files declared by package exports', () => {
    expect(buildConfig).toMatchObject({ fixedExtension: false });
  });
});
