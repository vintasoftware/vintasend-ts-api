import { describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/config.js';

describe('loadServerConfig', () => {
  it('requires an API key', () => {
    expect(() => loadServerConfig({})).toThrow('VINTASEND_API_KEY is required');
  });

  it('applies defaults', () => {
    const config = loadServerConfig({ VINTASEND_API_KEY: 'secret' });

    expect(config).toMatchObject({
      port: 3333,
      host: '0.0.0.0',
      apiKey: 'secret',
      corsOrigins: [],
      serviceModule: './vintasend.config.js',
      backendIdentifier: undefined,
    });
  });

  it('parses the CORS origin list', () => {
    const config = loadServerConfig({
      VINTASEND_API_KEY: 'secret',
      VINTASEND_API_CORS_ORIGINS: 'https://a.example.com, https://b.example.com',
    });

    expect(config.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadServerConfig({ VINTASEND_API_KEY: 'secret', PORT: 'abc' })).toThrow(
      'PORT must be a positive integer',
    );
  });
});
