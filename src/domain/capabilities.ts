/**
 * The capability map is a backend report, and only part of it is any of a
 * client's business.
 *
 * `/api/v1/capabilities` exists so consumers can hide sorting and filtering
 * affordances the backend cannot honour. Pagination conventions are not that:
 * the wire contract is unconditionally 1-indexed and this server does the
 * conversion, so publishing `pagination.oneIndexed` would only invite a client
 * to convert a second time.
 */

import type { NotificationFilterCapabilities } from 'vintasend';

import type { FilterCapabilities } from '../contract/types.js';

/**
 * Capability namespaces that describe how the server talks to its backend,
 * rather than what a client may ask for.
 */
const BACKEND_ONLY_CAPABILITY_PREFIXES = ['pagination.'];

export function toWireCapabilities(
  capabilities: NotificationFilterCapabilities,
): FilterCapabilities {
  return Object.fromEntries(
    Object.entries(capabilities).filter(
      ([key]) => !BACKEND_ONLY_CAPABILITY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}
