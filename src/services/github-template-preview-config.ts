export const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';

export type GitHubTemplatePreviewConfig = {
  repo: string;
  apiKey: string;
  apiBaseUrl: string;
  templatesBasePath?: string;
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeRepo(repo: string): string {
  const trimmedRepo = repo.trim().replace(/\.git$/, '');

  if (/^https?:\/\//i.test(trimmedRepo)) {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(trimmedRepo);
    } catch {
      throw new Error('GITHUB_REPO must be a valid GitHub repository URL or owner/repo.');
    }

    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      throw new Error('GITHUB_REPO URL must include owner and repository name.');
    }

    return `${segments[0]}/${segments[1]}`;
  }

  const sshMatch = trimmedRepo.match(/^git@[^:]+:([^/\s]+)\/([^/\s]+)$/);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repoName = sshMatch[2]?.replace(/\.git$/, '');
    return `${owner}/${repoName}`;
  }

  const directMatch = trimmedRepo.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (directMatch) {
    return `${directMatch[1]}/${directMatch[2]}`;
  }

  throw new Error('GITHUB_REPO is required in owner/repo format or as a GitHub repository URL.');
}

export function getGitHubTemplatePreviewConfigFromEnv(): GitHubTemplatePreviewConfig {
  const repo = process.env.GITHUB_REPO?.trim();
  const apiKey = process.env.GITHUB_API_KEY?.trim();
  const apiBaseUrl = (process.env.GITHUB_API_BASE_URL || DEFAULT_GITHUB_API_BASE_URL).trim();
  const templatesBasePath = process.env.GITHUB_TEMPLATES_BASE_PATH?.trim();

  if (!repo) {
    throw new Error('GITHUB_REPO is required (owner/repo).');
  }

  if (!apiKey) {
    throw new Error('GITHUB_API_KEY is required for template preview.');
  }

  return {
    repo: normalizeRepo(repo),
    apiKey,
    apiBaseUrl: normalizeBaseUrl(apiBaseUrl),
    templatesBasePath,
  };
}
