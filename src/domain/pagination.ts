/**
 * Page-number translation between the wire contract and the backend.
 *
 * The API is always 1-indexed: `page=1` is the first page, in every
 * implementation of this contract. Backends are not: the TypeScript VintaSend
 * backends are 0-indexed (`vintasend-prisma` and `vintasend-medplum` both
 * translate `page` as `page * pageSize`), while the Python ones are 1-indexed.
 * The offset therefore comes from the backend's `pagination.oneIndexed`
 * capability rather than from a hardcoded assumption.
 *
 * A backend that reports no capability at all falls back to this library's own
 * convention, 0-indexed. In practice the key is always present: VintaSend merges
 * its defaults under the backend's report.
 */

import type { NotificationFilterCapabilities } from 'vintasend';

export function isOneIndexedBackend(capabilities: NotificationFilterCapabilities): boolean {
  return capabilities['pagination.oneIndexed'] === true;
}

/**
 * Converts a 1-indexed page from the contract into the backend's own numbering.
 */
export function toBackendPage(page: number, capabilities: NotificationFilterCapabilities): number {
  return isOneIndexedBackend(capabilities) ? page : page - 1;
}
