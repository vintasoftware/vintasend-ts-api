import { vi } from 'vitest';
import type { TemplateSourceClient } from '../../src/services/notification-preview.js';
import type { NotificationServicePort } from '../../src/services/notification-service-port.js';

export const TEST_API_KEY = 'test-api-key';

export const authHeaders = { Authorization: `Bearer ${TEST_API_KEY}` };

type NotificationOverrides = Record<string, unknown>;

export function makeUserNotification(overrides: NotificationOverrides = {}) {
  return {
    id: 'notif-1',
    userId: 'user-1',
    notificationType: 'EMAIL',
    title: 'Test Notification',
    contextName: 'testContext',
    contextParameters: { param: 'test' },
    contextUsed: { key: 'value' },
    status: 'SENT',
    sendAfter: null,
    sentAt: new Date('2024-01-15T10:00:00Z'),
    readAt: null,
    createdAt: new Date('2024-01-15T09:00:00Z'),
    updatedAt: new Date('2024-01-15T09:30:00Z'),
    adapterUsed: 'mailgun',
    bodyTemplate: 'emails/body.pug',
    subjectTemplate: 'emails/subject.pug',
    extraParams: null,
    tenant: 'tenant-1',
    gitCommitSha: 'abc123',
    attachments: [],
    ...overrides,
  };
}

export function makeOneOffNotification(overrides: NotificationOverrides = {}) {
  const { userId: _userId, ...base } = makeUserNotification();

  return {
    ...base,
    id: 'oneoff-1',
    emailOrPhone: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    ...overrides,
  };
}

/**
 * A fully stubbed service; individual tests override the methods they exercise.
 */
export function makeService(overrides: Record<string, unknown> = {}): NotificationServicePort {
  return {
    getBackendSupportedFilterCapabilities: vi.fn().mockResolvedValue({
      'stringLookups.includes': true,
      'stringLookups.caseInsensitive': true,
      'orderBy.createdAt': true,
      'orderBy.sentAt': true,
      'orderBy.sendAfter': true,
      'orderBy.readAt': true,
      'orderBy.updatedAt': true,
    }),
    filterNotifications: vi.fn().mockResolvedValue([]),
    getPendingNotifications: vi.fn().mockResolvedValue([]),
    getFutureNotifications: vi.fn().mockResolvedValue([]),
    getOneOffNotifications: vi.fn().mockResolvedValue([]),
    getNotification: vi.fn().mockResolvedValue(null),
    getOneOffNotification: vi.fn().mockResolvedValue(null),
    resendNotification: vi.fn().mockResolvedValue(undefined),
    cancelNotification: vi.fn().mockResolvedValue(undefined),
    renderEmailTemplateFromContent: vi
      .fn()
      .mockResolvedValue({ subject: '<h1>Subject</h1>', body: '<p>Body</p>' }),
    ...overrides,
  } as unknown as NotificationServicePort;
}

export function makeTemplateClient(
  overrides: Partial<TemplateSourceClient> = {},
): TemplateSourceClient {
  return {
    getTemplateContentByCommit: vi.fn().mockResolvedValue('h1 Hello'),
    getLatestMainCommitSha: vi.fn().mockResolvedValue('main-sha'),
    ...overrides,
  };
}
