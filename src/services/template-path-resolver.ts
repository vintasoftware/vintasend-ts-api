export type TemplatePathResolverOptions = {
  templatesBasePath?: string;
};

function trimPathEdges(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

export function resolveTemplatePath(
  templatePath: string,
  options: TemplatePathResolverOptions = {},
): string {
  const cleanedTemplatePath = trimPathEdges(templatePath.trim());

  if (!cleanedTemplatePath) {
    throw new Error('Template path is required for preview rendering.');
  }

  const cleanedBasePath = options.templatesBasePath
    ? trimPathEdges(options.templatesBasePath.trim())
    : '';

  if (!cleanedBasePath) {
    return cleanedTemplatePath;
  }

  return `${cleanedBasePath}/${cleanedTemplatePath}`;
}
