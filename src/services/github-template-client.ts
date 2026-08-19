import {
  type GitHubTemplatePreviewConfig,
  getGitHubTemplatePreviewConfigFromEnv,
} from './github-template-preview-config.js';
import { resolveTemplatePath } from './template-path-resolver.js';

type GitHubTemplateClientOptions = {
  cacheMaxEntries?: number;
};

type Fetcher = typeof fetch;

type GitHubFileContentResponse = {
  content?: string;
  encoding?: string;
  message?: string;
};

type GitHubCommitResponse = {
  sha?: string;
  message?: string;
};

export type TemplateContentRequest = {
  templatePath: string;
  gitCommitSha: string;
};

export class GitHubTemplateClient {
  private readonly cacheMaxEntries: number;

  private readonly cache = new Map<string, string>();

  constructor(
    private readonly config: GitHubTemplatePreviewConfig,
    private readonly fetcher: Fetcher = fetch,
    options: GitHubTemplateClientOptions = {},
  ) {
    this.cacheMaxEntries = options.cacheMaxEntries ?? 100;
  }

  async getTemplateContentByCommit(request: TemplateContentRequest): Promise<string> {
    const resolvedPath = resolveTemplatePath(request.templatePath, {
      templatesBasePath: this.config.templatesBasePath,
    });

    const cacheKey = this.buildCacheKey(resolvedPath, request.gitCommitSha);
    const fromCache = this.cache.get(cacheKey);
    if (fromCache !== undefined) {
      return fromCache;
    }

    const apiUrl = this.buildApiUrl(resolvedPath, request.gitCommitSha);
    const response = await this.fetcher(apiUrl, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      throw await this.buildHttpError(response);
    }

    const payload = (await response.json()) as GitHubFileContentResponse;

    if (!payload.content || payload.encoding !== 'base64') {
      throw new Error('GitHub template response is invalid or unsupported.');
    }

    const decoded = Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8');
    this.setCache(cacheKey, decoded);
    return decoded;
  }

  async getLatestMainCommitSha(): Promise<string> {
    const apiUrl = `${this.config.apiBaseUrl}/repos/${this.config.repo}/commits/main`;
    const response = await this.fetcher(apiUrl, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      throw await this.buildCommitLookupHttpError(response);
    }

    const payload = (await response.json()) as GitHubCommitResponse;
    if (!payload.sha) {
      throw new Error('GitHub main branch commit lookup returned an invalid response.');
    }

    return payload.sha;
  }

  private buildApiUrl(path: string, gitCommitSha: string): string {
    const encodedPath = path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    const refParam = encodeURIComponent(gitCommitSha);
    return `${this.config.apiBaseUrl}/repos/${this.config.repo}/contents/${encodedPath}?ref=${refParam}`;
  }

  private buildCacheKey(path: string, gitCommitSha: string): string {
    return `${this.config.repo}:${path}:${gitCommitSha}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private setCache(key: string, value: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, value);

    while (this.cache.size > this.cacheMaxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (!firstKey) {
        break;
      }
      this.cache.delete(firstKey);
    }
  }

  private async buildHttpError(response: Response): Promise<Error> {
    if (response.status === 404) {
      return new Error('Template file was not found in GitHub for the requested commit.');
    }

    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        return new Error('GitHub API rate limit exceeded while fetching template preview.');
      }

      return new Error(
        'GitHub API request was forbidden. Check repository access and token permissions.',
      );
    }

    if (response.status === 429) {
      return new Error('GitHub API rate limit exceeded while fetching template preview.');
    }

    let messageSuffix = '';

    try {
      const body = (await response.json()) as GitHubFileContentResponse;
      if (body.message) {
        messageSuffix = `: ${body.message}`;
      }
    } catch {
      // noop
    }

    return new Error(`GitHub template fetch failed with status ${response.status}${messageSuffix}`);
  }

  private async buildCommitLookupHttpError(response: Response): Promise<Error> {
    if (response.status === 404) {
      return new Error('Unable to resolve latest commit SHA from the main branch.');
    }

    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        return new Error('GitHub API rate limit exceeded while fetching template preview.');
      }

      return new Error(
        'GitHub API request was forbidden. Check repository access and token permissions.',
      );
    }

    if (response.status === 429) {
      return new Error('GitHub API rate limit exceeded while fetching template preview.');
    }

    let messageSuffix = '';

    try {
      const body = (await response.json()) as GitHubCommitResponse;
      if (body.message) {
        messageSuffix = `: ${body.message}`;
      }
    } catch {
      // noop
    }

    return new Error(
      `GitHub main branch commit lookup failed with status ${response.status}${messageSuffix}`,
    );
  }
}

export function createGitHubTemplateClientFromEnv(
  options: GitHubTemplateClientOptions = {},
): GitHubTemplateClient {
  return new GitHubTemplateClient(getGitHubTemplatePreviewConfigFromEnv(), fetch, options);
}
