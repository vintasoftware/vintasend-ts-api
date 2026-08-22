/**
 * The two template-version fields on the wire.
 *
 * The contract is shared with the Python implementation, and this is the behavioural half of
 * that agreement: `openapi.yaml` says the fields exist, and these say the server actually
 * serializes them and accepts the two query parameters.
 *
 * Version **0** is the recurring theme. It is a legal value the schema admits, and every
 * truthiness check between here and the backend would silently drop it.
 */

import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { DataResponse, NotificationDetail, PaginatedResponse } from '../src/contract/types.js';
import { buildBackendFilter } from '../src/domain/filters.js';
import {
  authHeaders,
  makeService,
  makeTemplateClient,
  makeUserNotification,
  TEST_API_KEY,
} from './helpers/fixtures.js';

function appWith(service: ReturnType<typeof makeService>) {
  return createApp({
    apiKey: TEST_API_KEY,
    getService: async () => service,
    getTemplateClient: makeTemplateClient,
  });
}

async function listWith(notification: Record<string, unknown>) {
  const service = makeService({
    filterNotifications: vi.fn().mockResolvedValue([notification]),
  });
  const response = await appWith(service).request('http://localhost/api/v1/notifications', {
    headers: authHeaders,
  });
  return (await response.json()) as PaginatedResponse<Record<string, unknown>>;
}

describe('serialization', () => {
  it('reports both versions a notification carries', async () => {
    const body = await listWith(
      makeUserNotification({ requestedTemplateVersion: 3, usedTemplateVersion: 3 }),
    );

    expect(body.data[0]).toMatchObject({
      requestedTemplateVersion: 3,
      usedTemplateVersion: 3,
    });
  });

  it('reports null rather than omitting them on an unpinned notification', async () => {
    const body = await listWith(
      makeUserNotification({ requestedTemplateVersion: null, usedTemplateVersion: null }),
    );

    expect(body.data[0]).toHaveProperty('requestedTemplateVersion', null);
    expect(body.data[0]).toHaveProperty('usedTemplateVersion', null);
  });

  it('reports null for a backend that does not store them at all', async () => {
    // The fields are optional on the backend seam, so an older backend leaves them undefined —
    // and the contract types them nullable, not optional.
    const {
      requestedTemplateVersion: _r,
      usedTemplateVersion: _u,
      ...older
    } = {
      ...makeUserNotification(),
      requestedTemplateVersion: undefined,
      usedTemplateVersion: undefined,
    };
    const body = await listWith(older);

    expect(body.data[0]).toHaveProperty('requestedTemplateVersion', null);
    expect(body.data[0]).toHaveProperty('usedTemplateVersion', null);
  });

  it('reports version 0 as 0, not as null', async () => {
    const body = await listWith(
      makeUserNotification({ requestedTemplateVersion: 0, usedTemplateVersion: 0 }),
    );

    expect(body.data[0]).toMatchObject({
      requestedTemplateVersion: 0,
      usedTemplateVersion: 0,
    });
  });

  it('reports them on the detail endpoint too', async () => {
    const service = makeService({
      getNotification: vi
        .fn()
        .mockResolvedValue(makeUserNotification({ requestedTemplateVersion: 2 })),
    });

    const response = await appWith(service).request(
      'http://localhost/api/v1/notifications/notif-1',
      { headers: authHeaders },
    );
    const body = (await response.json()) as DataResponse<NotificationDetail>;

    expect(body.data.requestedTemplateVersion).toBe(2);
  });
});

describe('filtering', () => {
  async function filterPassedFor(query: string) {
    const filterNotifications = vi.fn().mockResolvedValue([]);
    const service = makeService({ filterNotifications });

    const response = await appWith(service).request(
      `http://localhost/api/v1/notifications?${query}`,
      { headers: authHeaders },
    );

    return { status: response.status, filter: filterNotifications.mock.calls[0]?.[0] };
  }

  it('passes a requested version through to the backend', async () => {
    const { status, filter } = await filterPassedFor('requestedTemplateVersion=3');

    expect(status).toBe(200);
    expect(filter).toMatchObject({ requestedTemplateVersion: 3 });
  });

  it('passes a used version through to the backend', async () => {
    const { filter } = await filterPassedFor('usedTemplateVersion=7');

    expect(filter).toMatchObject({ usedTemplateVersion: 7 });
  });

  it('passes version 0 rather than dropping it as falsy', async () => {
    const { filter } = await filterPassedFor('requestedTemplateVersion=0');

    expect(filter).toMatchObject({ requestedTemplateVersion: 0 });
  });

  it('sends no version filter when the parameter is absent', async () => {
    const { filter } = await filterPassedFor('status=SENT');

    expect(filter).not.toHaveProperty('requestedTemplateVersion');
    expect(filter).not.toHaveProperty('usedTemplateVersion');
  });

  it('rejects a negative version', async () => {
    const { status } = await filterPassedFor('requestedTemplateVersion=-1');

    expect(status).toBe(400);
  });

  it('rejects a non-integer version', async () => {
    expect((await filterPassedFor('usedTemplateVersion=1.5')).status).toBe(400);
    expect((await filterPassedFor('usedTemplateVersion=abc')).status).toBe(400);
  });
});

describe('buildBackendFilter', () => {
  const query = {
    page: 1,
    pageSize: 20,
    requestedTemplateVersion: 0,
    usedTemplateVersion: 0,
  } as never;

  it('keeps version 0, which a truthiness check would drop', () => {
    expect(buildBackendFilter(query, {})).toMatchObject({
      requestedTemplateVersion: 0,
      usedTemplateVersion: 0,
    });
  });

  it('passes the fields through whatever the backend advertises', () => {
    // Not capability-gated, matching the Python implementation: both keys default to unsupported
    // in VintaSend's map, so gating here would drop the filter for every backend that has not
    // opted in.
    const filter = buildBackendFilter(query, {
      'fields.requestedTemplateVersion': false,
      'fields.usedTemplateVersion': false,
    });

    expect(filter).toMatchObject({ requestedTemplateVersion: 0, usedTemplateVersion: 0 });
  });
});
