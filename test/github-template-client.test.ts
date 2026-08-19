/**
 * Ported from the dashboard, which used to fetch templates itself.
 * The lookup-logging test was dropped along with the log line.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubTemplateClient } from '../src/services/github-template-client.js';
import {
  DEFAULT_GITHUB_API_BASE_URL,
  getGitHubTemplatePreviewConfigFromEnv,
} from '../src/services/github-template-preview-config.js';

const originalEnv = process.env;

function makeClient(
  fetchMock: ReturnType<typeof vi.fn>,
  overrides: { templatesBasePath?: string } = {},
  options: { cacheMaxEntries?: number } = {},
) {
  return new GitHubTemplateClient(
    {
      repo: 'vintasoftware/vintasend-ts',
      apiKey: 'token',
      apiBaseUrl: 'https://api.github.com',
      ...overrides,
    },
    fetchMock as unknown as typeof fetch,
    options,
  );
}

function okResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      content: Buffer.from(content).toString('base64'),
      encoding: 'base64',
    }),
  };
}

describe('getGitHubTemplatePreviewConfigFromEnv', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('builds config from env using defaults when optional vars are missing', () => {
    process.env.GITHUB_REPO = 'vintasoftware/vintasend-ts';
    process.env.GITHUB_API_KEY = 'token';
    process.env.GITHUB_API_BASE_URL = undefined;

    const config = getGitHubTemplatePreviewConfigFromEnv();

    expect(config.repo).toBe('vintasoftware/vintasend-ts');
    expect(config.apiKey).toBe('token');
    expect(config.apiBaseUrl).toBe(DEFAULT_GITHUB_API_BASE_URL);
  });

  it('normalizes a full GitHub repository URL to owner/repo', () => {
    process.env.GITHUB_REPO = 'https://github.com/vintasoftware/vintasend-medplum-example';
    process.env.GITHUB_API_KEY = 'token';

    expect(getGitHubTemplatePreviewConfigFromEnv().repo).toBe(
      'vintasoftware/vintasend-medplum-example',
    );
  });

  it('requires the repo and API key', () => {
    process.env.GITHUB_REPO = '';
    process.env.GITHUB_API_KEY = 'token';

    expect(() => getGitHubTemplatePreviewConfigFromEnv()).toThrow('GITHUB_REPO is required');
  });
});

describe('GitHubTemplateClient', () => {
  it('fetches file content using ref=<gitCommitSha> in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('hello world'));
    const client = makeClient(fetchMock, { templatesBasePath: 'src/templates' });

    const content = await client.getTemplateContentByCommit({
      templatePath: 'emails/welcome.pug',
      gitCommitSha: 'a'.repeat(40),
    });

    expect(content).toBe('hello world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(
      '/repos/vintasoftware/vintasend-ts/contents/src/templates/emails/welcome.pug?ref=',
    );
    expect(calledUrl).toContain('a'.repeat(40));
  });

  it('returns a deterministic safe error for not-found responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      json: async () => ({ message: 'Not Found' }),
    });

    await expect(
      makeClient(fetchMock).getTemplateContentByCommit({
        templatePath: 'templates/missing.pug',
        gitCommitSha: 'b'.repeat(40),
      }),
    ).rejects.toThrow('Template file was not found in GitHub for the requested commit.');
  });

  it('returns a deterministic safe error for rate-limit responses', async () => {
    const headers = new Headers();
    headers.set('x-ratelimit-remaining', '0');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers,
      json: async () => ({ message: 'API rate limit exceeded' }),
    });

    await expect(
      makeClient(fetchMock).getTemplateContentByCommit({
        templatePath: 'templates/welcome.pug',
        gitCommitSha: 'c'.repeat(40),
      }),
    ).rejects.toThrow('GitHub API rate limit exceeded while fetching template preview.');
  });

  it('returns cached content for repeated repo:path:sha requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('cached-value'));
    const client = makeClient(fetchMock, {}, { cacheMaxEntries: 10 });

    const request = { templatePath: 'templates/welcome.pug', gitCommitSha: 'd'.repeat(40) };

    expect(await client.getTemplateContentByCommit(request)).toBe('cached-value');
    expect(await client.getTemplateContentByCommit(request)).toBe('cached-value');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves the latest main commit SHA', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sha: 'f'.repeat(40) }),
    });

    expect(await makeClient(fetchMock).getLatestMainCommitSha()).toBe('f'.repeat(40));
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/repos/vintasoftware/vintasend-ts/commits/main',
    );
  });
});
