# VintaSend API

REST API that exposes a [VintaSend](https://github.com/vintasoftware/vintasend-ts)
notification service over HTTP.

It exists so the [VintaSend dashboard](https://github.com/vintasoftware/vintasend-ts-dashboard)
no longer has to embed a notification service: the dashboard is now a pure API
client, and any implementation of this contract can serve it — including a
future one built on the Python `vintasend` package.

**[`openapi.yaml`](./openapi.yaml) is the contract.** This repository is the
TypeScript reference implementation of it, published to npm so a project can
mount it rather than copy it.

## Two ways to run it

**Mounted in your own server** — the usual case for an app that already has
one. `createApp` returns a [Hono](https://hono.dev) app, which takes a standard
`Request` and returns a `Response`, so it mounts in a Next.js route handler, in
TanStack Start, behind Express, or anywhere else that speaks `fetch`. You hand it
the service you already built to send notifications, and your own check of who
is calling. See [Mounting it](#mounting-it).

**On its own** — the `vintasend-api` command runs a server configured from
environment variables, behind one shared API key. See
[Running it on its own](#running-it-on-its-own).

Either way, the API ships no notification backend: database, adapters and
template renderer are yours.

## Installing

```bash
npm install vintasend-api vintasend
```

`vintasend` is a peer dependency, so your service and the API share one copy.
Install the same release line for both: the API is released together with
`vintasend`, and its version matches.

## Architecture

```
┌─────────────────────┐   HTTPS + API key    ┌──────────────────┐
│  Dashboard (Next)   │ ───────────────────▶ │  vintasend-api   │
│  server-side only   │ ◀─────────────────── │  (this repo)     │
└─────────────────────┘     JSON contract    └────────┬─────────┘
                                                      │
                                       ┌──────────────┴──────────────┐
                                       │  Your VintaSend service     │
                                       │  backend + adapters +       │
                                       │  template renderer          │
                                       └─────────────────────────────┘
```

The API owns everything that needs backend credentials — database access,
template rendering, GitHub template lookups. The UI owns presentation and user
authentication.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe (unauthenticated) |
| GET | `/api/v1/capabilities` | Filter/order capabilities of the configured backend |
| GET | `/api/v1/notifications` | List notifications with filters, ordering and pagination |
| GET | `/api/v1/notifications/pending` | Notifications awaiting send |
| GET | `/api/v1/notifications/future` | Notifications scheduled for the future |
| GET | `/api/v1/notifications/one-off` | One-off notifications |
| GET | `/api/v1/notifications/{id}` | One notification, including context payloads |
| GET | `/api/v1/notifications/{id}/preview` | Templates rendered at the notification's commit |
| POST | `/api/v1/notifications/{id}/resend` | Resend a notification |
| POST | `/api/v1/notifications/{id}/cancel` | Cancel a pending notification |

Conventions worth knowing when implementing this contract elsewhere:

- `page` is **1-indexed** in the API, in every implementation, and clients never
  convert. What the backend wants is a separate question: the TypeScript
  VintaSend backends are 0-indexed, the Python ones are 1-indexed. The offset
  comes from the backend's `pagination.oneIndexed` capability — porting this
  server's `page - 1` literally into a 1-indexed language is an off-by-one. The
  capability is backend-facing and is not published by `/api/v1/capabilities`.
- `hasMore` is `true` when the next page has at least one row, so a list that
  exactly fills its last page never offers an empty one. Backends are not
  required to produce a total count: after a full page, the server reads the one
  row that would follow it.
- List rows carry a `kind` field (`user` or `one-off`) so clients can
  discriminate without sniffing for the presence of fields.
- Timestamps are ISO-8601 UTC strings, `null` when unset — never `undefined`.
- Errors always use the envelope `{ "error": { "code", "message", "details"? } }`.
  Failures that come from the template source are `UPSTREAM_ERROR` (502), not a
  generic 500.
- Every 400 carries `details.issues: [{ path, message }]`, whatever the mistake
  was. `path` names the field, and is empty for the body as a whole.
- `FORBIDDEN` (403) is for a caller who is authenticated and not allowed — what a
  host's own authentication answers. The API key alone never produces it.
- Request bodies are JSON. A request declaring `application/json` (or any
  `application/*+json`) must carry valid JSON. A request declaring no media type,
  or another one, counts as an omitted body when it is empty and is a 400
  otherwise — `curl -d` sends form encoding unless told otherwise, and reading
  its body as `{}` would resend with a regenerated context instead of the stored
  one.

## Mounting it

```ts
// app/api/v1/[...path]/route.ts — a Next.js app router route handler
import {
  ApiError,
  asNotificationServicePort,
  createApp,
  createGitHubTemplateClientFromEnv,
} from 'vintasend-api';
import { notificationService } from '@/lib/notifications';
import { getSession } from '@/lib/auth';

const app = createApp({
  // The service your app already sends with. VintaSend services are generic over your
  // notification config, so the port takes it through a cast confined to this one call.
  getService: async () => asNotificationServicePort(notificationService),
  // Runs before every /api/v1 route. Throw to refuse.
  authenticate: async (c) => {
    const user = await getSession(c.req.raw);
    if (!user) throw ApiError.unauthorized('Sign in first.');
    if (!user.canManageNotifications) throw ApiError.forbidden('Not allowed.');
    return {};
  },
  // Where previews read templates from, at the commit a notification was sent with.
  getTemplateClient: () => createGitHubTemplateClientFromEnv(),
  // Every error not mapped to a contract error. Defaults to one redacted log line.
  onUnhandledError: (error, _c, { requestId }) => errorTracker.capture(error, { requestId }),
});

const handler = (request: Request) => app.fetch(request);
export { handler as GET, handler as POST };
```

Behind Express, hand `getRequestListener(app.fetch)` from `@hono/node-server` to a
route that keeps the path whole — `server.all(...)`, not `server.use('/api/v1', ...)`,
which strips the prefix the API's routes include.

`authenticate` has the same shape in
[`vintasend-templates-management-api`](https://github.com/vintasoftware/vintasend-ts-templates-management-api),
so an app mounting both passes them one function. It may throw the `ApiError` of
either package: both recognise an error by its name and code, not by its class.
Throw `ApiError.unauthorized` for a caller with no valid credential and
`ApiError.forbidden` for one you know and refuse: a 401 would tell a signed-in
user to sign in again. For one shared secret, pass
`authenticate: apiKeyAuthenticator(key)`, which compares in constant time.

The app uses Web APIs only — no Node built-ins — so it runs wherever `fetch`
does. The standalone server and the module-path service loader are the Node-only
parts, and `createApp` loads neither.

An unexpected error is reported to the client as a generic 500 with an
`X-Request-Id` header. By default it is logged as one line — the error's name,
the request id and the route pattern — and never with its message, its stack or
the request: errors from a notification backend or provider can quote
notification content and context values, which in the applications this API
serves can be health data. `onUnhandledError` hands the error to your own
tracker instead; keeping health data out of it is then your call. If it throws,
the default line is logged in its place.

## Running it on its own

Every `/api/v1` request must carry the shared secret:

```
Authorization: Bearer $VINTASEND_API_KEY
```

The dashboard calls this API only from its own server side, so the key never
reaches a browser. If you do need to call the API from a browser, set
`VINTASEND_API_CORS_ORIGINS` to the allowed origins — and put a per-user auth
layer in front of it first.

```bash
VINTASEND_API_KEY=… VINTASEND_SERVICE_MODULE=./vintasend.config.js npx vintasend-api
```

To work on this repository instead:

```bash
npm install
cp .env.example .env
npm run dev
```

## Configuring your VintaSend service

The standalone server ships no backend of its own: which database, adapters and
template renderer to use is a deployment decision. Point
`VINTASEND_SERVICE_MODULE` at a module that default-exports a factory returning a
configured VintaSend service:

```ts
// src/vintasend.config.ts
import { VintaSendFactory } from 'vintasend';

export default async function createVintaSendService() {
  const backend = /* your backend */;
  const renderer = /* your template renderer */;
  const adapter = /* your notification adapter */;

  return new VintaSendFactory<Config>().create(backend, [adapter], contextGenerators);
}
```

Start from [`src/vintasend.config.example.ts`](./src/vintasend.config.example.ts),
copying it to `src/vintasend.config.ts` (gitignored) so it is compiled along with
the rest of `src`. The factory is called once at startup, and a failure there
stops the server rather than surfacing on the first request.

`VINTASEND_SERVICE_MODULE` accepts a path relative to the working directory or a
bare package specifier. Use `./dist/vintasend.config.js` with `npm start`, and
`./src/vintasend.config.ts` with `npm run dev`, which runs TypeScript directly.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `VINTASEND_API_KEY` | yes | Shared secret clients must send as a bearer token. |
| `VINTASEND_SERVICE_MODULE` | no | Module building your VintaSend service. Defaults to `./dist/vintasend.config.js`. |
| `VINTASEND_BACKEND_IDENTIFIER` | no | Read from a non-primary backend registered in your service. |
| `VINTASEND_API_CORS_ORIGINS` | no | Comma-separated browser origins allowed to call the API. |
| `PORT` / `HOST` | no | Listen address. Defaults to `3333` / `0.0.0.0`. |
| `GITHUB_REPO` | preview only | Repository holding the templates, as `owner/repo` or a full URL. |
| `GITHUB_API_KEY` | preview only | Token with read access to that repository. |
| `GITHUB_API_BASE_URL` | no | Defaults to `https://api.github.com`. |
| `GITHUB_TEMPLATES_BASE_PATH` | no | Prefix added to template paths before the GitHub lookup. |

The `GITHUB_*` variables are only read when `/preview` is called, so the API
runs fine without them if you do not use template previews.

## Development

```bash
npm run dev        # watch mode
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # biome
npm run build      # compile to dist/
npm start          # run the compiled server
```

Tests drive the real Hono app through `app.request()` with an injected fake
service, so they cover routing, auth, validation, filter negotiation and
serialization without needing a database.

## Implementing this contract in another language

1. Read `openapi.yaml` — it is normative, including status codes and error codes.
2. Mirror the `hasMore` rule (another page has a row) and the `kind`
   discriminator exactly; the dashboard depends on both.
3. Take the page offset from your backend's `pagination.oneIndexed` capability,
   not from this implementation. The wire stays 1-indexed either way, so a
   1-indexed backend passes the page straight through — no `- 1`. Apply it to
   every paginated read, and keep the capability out of the `/capabilities`
   response so no client converts on top of you.
4. Treat `stringLookups.caseSensitive` and `stringLookups.caseInsensitive` as
   independent: a backend can be incapable of either one, and deriving one from
   the other declines the single lookup such a backend actually supports.
5. Negotiate string lookups and ordering against your backend's capabilities,
   and report what you support from `/api/v1/capabilities`. Dropping an
   unsupported ordering is correct; failing the request is not.
6. Report template-source failures as `UPSTREAM_ERROR` (502) rather than a
   generic 500: a rate-limited or unreachable template host is not a fault of
   the API, and the dashboard shows the message to the operator.
7. Keep the error envelope identical — the dashboard branches on `error.code` —
   including `details.issues` on every 400 and the request-body rule.

## License

MIT
