/**
 * What a host installing the package gets: an entry that loads in a browser, the standalone
 * server's pieces on their own entry, the bearer-token helper, and dependencies that do not drag
 * the Node HTTP server into its install.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as entry from '../src/exports.js';
import { bearerToken } from '../src/middleware/authenticate.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('bearerToken', () => {
  it('reads the token from a Bearer header', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
  });

  it('accepts the scheme in any case, as RFC 9110 has it', () => {
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('BEARER abc')).toBe('abc');
  });

  it('is null with no header', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
  });

  it('is null for another scheme, or a scheme with no token', () => {
    expect(bearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken('Bearer    ')).toBeNull();
  });

  it('is exported from the entry', () => {
    expect(typeof entry.bearerToken).toBe('function');
    expect(entry.bearerToken).toBe(bearerToken);
  });
});

describe('the package entry', () => {
  it('exports what a host mounts the API with', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'API_BASE_PATH',
      'API_VERSION',
      'ApiError',
      'GitHubTemplateClient',
      'REQUEST_ID_HEADER',
      'apiKeyAuthenticator',
      'asNotificationServicePort',
      'authenticated',
      'bearerToken',
      'createApp',
      'createGitHubTemplateClientFromEnv',
      'invalidRequest',
      'logUnhandledError',
    ]);
  });

  it('serves the standalone server pieces from ./server', async () => {
    const server = await import('../src/server.js');

    expect(pkg.exports['./server']).toEqual({
      types: './dist/server.d.ts',
      import: './dist/server.js',
    });
    expect(Object.keys(server).sort()).toEqual([
      'createServiceProvider',
      'loadNotificationService',
      'loadServerConfig',
    ]);
  });

  it('declares no side effects, so a bundler can drop what a host does not import', () => {
    expect(pkg.sideEffects).toBe(false);
  });
});

describe('dependencies', () => {
  it('does not install the Node HTTP server in a host that only mounts createApp', () => {
    expect(pkg.dependencies['@hono/node-server']).toBeUndefined();
    expect(pkg.peerDependencies['@hono/node-server']).toBeDefined();
    expect(pkg.peerDependenciesMeta['@hono/node-server']).toEqual({ optional: true });
  });

  it('uses Zod 4, so a host on Zod 4 installs one copy', () => {
    expect(pkg.dependencies.zod).toMatch(/^\^4\./);
    expect(pkg.dependencies['@hono/zod-validator']).toMatch(/^\^0\.(7|8|9)\./);
  });
});
