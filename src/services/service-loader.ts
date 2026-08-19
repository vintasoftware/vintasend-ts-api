/**
 * Loads the operator-provided VintaSend service.
 *
 * The API ships no backend of its own: which database, adapters and template
 * renderers to use is a deployment decision. `VINTASEND_SERVICE_MODULE` points
 * at a module whose default export builds a configured VintaSend service; see
 * `vintasend.config.example.ts` and the README.
 */

import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  asNotificationServicePort,
  type NotificationServicePort,
} from './notification-service-port.js';

export type VintaSendServiceFactory = () => Promise<unknown> | unknown;

type ServiceModule = {
  default?: VintaSendServiceFactory;
  createVintaSendService?: VintaSendServiceFactory;
};

function resolveModuleSpecifier(modulePath: string): string {
  if (modulePath.startsWith('.') || isAbsolute(modulePath)) {
    return pathToFileURL(resolve(process.cwd(), modulePath)).href;
  }

  // Bare specifier: let Node resolve it from node_modules.
  return modulePath;
}

export async function loadNotificationService(
  modulePath: string,
): Promise<NotificationServicePort> {
  let loaded: ServiceModule;

  try {
    loaded = (await import(resolveModuleSpecifier(modulePath))) as ServiceModule;
  } catch (error) {
    throw new Error(
      `Could not load the VintaSend service module "${modulePath}". ` +
        'Set VINTASEND_SERVICE_MODULE to a module that default-exports a service factory ' +
        `(see vintasend.config.example.ts). Cause: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  const factory = loaded.default ?? loaded.createVintaSendService;

  if (typeof factory !== 'function') {
    throw new Error(
      `The VintaSend service module "${modulePath}" must export a default function ` +
        'that returns a configured VintaSend service.',
    );
  }

  const service = await factory();

  if (!service || typeof service !== 'object') {
    throw new Error(
      `The VintaSend service factory in "${modulePath}" did not return a service instance.`,
    );
  }

  return asNotificationServicePort(service);
}

/**
 * Builds the service once and reuses it for every request.
 */
export function createServiceProvider(modulePath: string): () => Promise<NotificationServicePort> {
  let cached: Promise<NotificationServicePort> | undefined;

  return () => {
    if (!cached) {
      cached = loadNotificationService(modulePath).catch((error) => {
        // Do not cache failures: a transient misconfiguration should be retried.
        cached = undefined;
        throw error;
      });
    }
    return cached;
  };
}
