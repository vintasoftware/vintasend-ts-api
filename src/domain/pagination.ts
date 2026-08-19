/**
 * Page-number translation between the wire contract and the backend.
 *
 * The API is always 1-indexed: `page=1` is the first page, in every
 * implementation of this contract. Backends are not consistent — the TypeScript
 * VintaSend backends are 0-indexed, the Python ones are 1-indexed — so the
 * offset is read from the backend's advertised `pagination.zeroIndexed`
 * capability rather than hardcoded. Backends that do not report capabilities
 * default to zero-indexed, which is correct for every TypeScript backend.
 */

import type { NotificationFilterCapabilities } from 'vintasend';

export function isZeroIndexedBackend(capabilities: NotificationFilterCapabilities): boolean {
  return capabilities['pagination.zeroIndexed'] !== false;
}

/**
 * Converts a 1-indexed page from the contract into the backend's own numbering.
 */
export function toBackendPage(page: number, capabilities: NotificationFilterCapabilities): number {
  return isZeroIndexedBackend(capabilities) ? page - 1 : page;
}
