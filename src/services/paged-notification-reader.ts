/**
 * The one place page numbers are translated.
 *
 * Routes deal exclusively in the contract's 1-indexed pages; this wrapper takes
 * those, reads the backend's pagination convention once per request, and calls
 * the service with whatever numbering it expects. Keeping the arithmetic here
 * rather than in each route means a route cannot forget it — which is how
 * `/pending`, `/future` and `/one-off` previously ended up paging by assumption.
 */

import type { NotificationFilterCapabilities, NotificationOrderBy } from 'vintasend';

import { toBackendPage } from '../domain/pagination.js';
import type {
  ApiAnyDatabaseNotification,
  ApiDatabaseOneOffNotification,
  ApiNotificationFilterFields,
  NotificationServicePort,
} from './notification-service-port.js';

export interface PagedNotificationReader {
  /**
   * The backend's capability report, fetched at most once per reader.
   */
  capabilities(): Promise<NotificationFilterCapabilities>;

  filterNotifications(
    filter: ApiNotificationFilterFields,
    page: number,
    pageSize: number,
    orderBy?: NotificationOrderBy,
  ): Promise<ApiAnyDatabaseNotification[]>;

  getPendingNotifications(page: number, pageSize: number): Promise<ApiAnyDatabaseNotification[]>;

  getFutureNotifications(page: number, pageSize: number): Promise<ApiAnyDatabaseNotification[]>;

  getOneOffNotifications(page: number, pageSize: number): Promise<ApiDatabaseOneOffNotification[]>;
}

export function createPagedNotificationReader(
  service: NotificationServicePort,
  backendIdentifier?: string | undefined,
): PagedNotificationReader {
  let cached: Promise<NotificationFilterCapabilities> | undefined;

  const capabilities = () => {
    if (!cached) {
      cached = service.getBackendSupportedFilterCapabilities(backendIdentifier);
    }
    return cached;
  };

  const backendPage = async (page: number) => toBackendPage(page, await capabilities());

  return {
    capabilities,

    async filterNotifications(filter, page, pageSize, orderBy) {
      return service.filterNotifications(
        filter,
        await backendPage(page),
        pageSize,
        orderBy,
        backendIdentifier,
      );
    },

    async getPendingNotifications(page, pageSize) {
      return service.getPendingNotifications(await backendPage(page), pageSize, backendIdentifier);
    },

    async getFutureNotifications(page, pageSize) {
      return service.getFutureNotifications(await backendPage(page), pageSize, backendIdentifier);
    },

    async getOneOffNotifications(page, pageSize) {
      return service.getOneOffNotifications(await backendPage(page), pageSize, backendIdentifier);
    },
  };
}
