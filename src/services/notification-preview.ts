/**
 * Builds a rendered preview of a notification's templates.
 *
 * Templates are fetched from GitHub at the commit SHA persisted with the
 * notification, so a preview always shows the template as it was when the
 * notification was created. Notifications that are still pending fall back to
 * the current `main` commit, since they have not been rendered yet.
 */

import type { NotificationPreview } from '../contract/types.js';
import { ApiError } from '../errors.js';
import type {
  ApiAnyDatabaseNotification,
  NotificationServicePort,
} from './notification-service-port.js';

export interface TemplateSourceClient {
  getTemplateContentByCommit(request: {
    templatePath: string;
    gitCommitSha: string;
  }): Promise<string>;
  getLatestMainCommitSha(): Promise<string>;
}

export async function buildNotificationPreview({
  service,
  templateClient,
  notification,
}: {
  service: NotificationServicePort;
  templateClient: TemplateSourceClient;
  notification: ApiAnyDatabaseNotification;
}): Promise<NotificationPreview> {
  let gitCommitSha = notification.gitCommitSha;

  if (!gitCommitSha && notification.status === 'PENDING_SEND') {
    gitCommitSha = await templateClient.getLatestMainCommitSha();
  }

  if (!gitCommitSha) {
    throw new ApiError(
      'PREVIEW_UNAVAILABLE',
      'This notification does not have a tracked git commit SHA and is not pending send, so preview is unavailable.',
    );
  }

  const bodyTemplateContent = await templateClient.getTemplateContentByCommit({
    templatePath: notification.bodyTemplate,
    gitCommitSha,
  });

  let subjectTemplateContent: string | null = null;
  if (notification.subjectTemplate) {
    subjectTemplateContent = await templateClient.getTemplateContentByCommit({
      templatePath: notification.subjectTemplate,
      gitCommitSha,
    });
  }

  // Context generators may be async, so a stored context is typed as possibly a
  // promise; awaiting resolves that without changing already-materialised data.
  const storedContext = notification.contextUsed ? await notification.contextUsed : null;

  const renderedTemplate = await service.renderEmailTemplateFromContent(
    notification,
    { body: bodyTemplateContent, subject: subjectTemplateContent },
    storedContext
      ? { context: storedContext }
      : {
          contextName: notification.contextName,
          contextParameters: notification.contextParameters,
        },
  );

  return {
    gitCommitSha,
    bodyTemplatePath: notification.bodyTemplate,
    subjectTemplatePath: notification.subjectTemplate,
    renderedBodyHtml: renderedTemplate.body,
    renderedSubjectHtml: renderedTemplate.subject,
  };
}
