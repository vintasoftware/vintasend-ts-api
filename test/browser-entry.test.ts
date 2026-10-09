/**
 * The package entry loads in a browser.
 *
 * A host's UI can run the API in memory for its stories and tests, and a bundler that refuses Node
 * built-ins on a browser target (esbuild with `platform: 'browser'`) fails outright on one.
 *
 * `vintasend` is a peer dependency: the host installs it, and it tests its own entry the same way.
 * Here it is a stand-in, so what is checked is this package's own modules and the dependencies it
 * brings.
 */

import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
import { build, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = fileURLToPath(new URL('../src/exports.ts', import.meta.url));
const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/')[0] as string);
}

/** The peer becomes a module whose every export is an empty class. */
const peerStandIn: Plugin = {
  name: 'peer-stand-in',
  setup(build) {
    build.onResolve({ filter: /^vintasend$/ }, (args) => ({ path: args.path, namespace: 'peer' }));
    build.onLoad({ filter: /.*/, namespace: 'peer' }, () => ({
      contents:
        'module.exports = new Proxy({}, { get: (_, name) => name === "__esModule" ? true : class {} });',
      loader: 'js',
    }));
  },
};

/**
 * What a browser provides that the bundle may use as it loads: Web APIs, and none of Node's own
 * globals (`process`, `Buffer`, `require`, `module`).
 */
const BROWSER_GLOBALS = {
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  Headers,
  Request,
  Response,
  ReadableStream,
  crypto,
  atob,
  btoa,
  console,
};

async function loadInBrowserContext(source: string): Promise<Record<string, unknown>> {
  const result = await build({
    stdin: { contents: source, resolveDir: ROOT, loader: 'ts' },
    alias: { 'vintasend-api': ENTRY },
    plugins: [peerStandIn],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'bundle',
    write: false,
    logLevel: 'silent',
  });
  const context = vm.createContext({ ...BROWSER_GLOBALS });
  vm.runInContext(result.outputFiles[0]?.text ?? '', context);
  return context.bundle as Record<string, unknown>;
}

describe('in a browser', () => {
  it('bundles createApp and loads it with no Node globals', async () => {
    const bundle = await loadInBrowserContext("export { createApp } from 'vintasend-api';");

    expect(typeof bundle.createApp).toBe('function');
  });

  it('bundles every export of the entry and loads it', async () => {
    const bundle = await loadInBrowserContext("export * from 'vintasend-api';");

    expect(typeof bundle.apiKeyAuthenticator).toBe('function');
  });

  it('imports no Node built-in anywhere in its module graph', async () => {
    // Bundled for Node, built-ins stay external, so the metafile lists every import of one,
    // static or dynamic, from this package's modules and from the dependencies it brings.
    const result = await build({
      entryPoints: [ENTRY],
      external: ['vintasend'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });

    const builtinImports = Object.entries(result.metafile.inputs).flatMap(([file, input]) =>
      input.imports
        .filter((imported) => isNodeBuiltin(imported.path))
        .map((imported) => `${file} -> ${imported.path}`),
    );

    expect(builtinImports).toEqual([]);
  });
});
