# VintaSend API

REST API that exposes a [VintaSend](https://github.com/vintasoftware/vintasend-ts)
notification service over HTTP.

It exists so the [VintaSend dashboard](https://github.com/vintasoftware/vintasend-ts-dashboard)
no longer has to embed a notification service: the dashboard is now a pure API
client, and any implementation of this contract can serve it — including a
future one built on the Python `vintasend` package.

**[`openapi.yaml`](./openapi.yaml) is the contract.** This repository is the
TypeScript reference implementation of it.

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
- `hasMore` is `true` when a page comes back full. Backends are not required to
  produce a total count.
- List rows carry a `kind` field (`user` or `one-off`) so clients can
  discriminate without sniffing for the presence of fields.
- Timestamps are ISO-8601 UTC strings, `null` when unset — never `undefined`.
- Errors always use the envelope `{ "error": { "code", "message", "details"? } }`.
  Failures that come from the template source are `UPSTREAM_ERROR` (502), not a
  generic 500.

## Authentication

Every `/api/v1` request must carry the shared secret:

```
Authorization: Bearer $VINTASEND_API_KEY
```

The dashboard calls this API only from its own server side, so the key never
reaches a browser. If you do need to call the API from a browser, set
`VINTASEND_API_CORS_ORIGINS` to the allowed origins — and put a per-user auth
layer in front of it first.

## Getting started

```bash
npm install
cp .env.example .env
```

Then configure the service the API should read from (below), and run:

```bash
npm run dev
```

## Configuring your VintaSend service

The API ships no backend of its own: which database, adapters and template
renderer to use is a deployment decision. Point `VINTASEND_SERVICE_MODULE` at a
module that default-exports a factory returning a configured VintaSend service:

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
2. Mirror the `hasMore` rule and the `kind` discriminator exactly; the dashboard
   depends on both.
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
7. Keep the error envelope identical — the dashboard branches on `error.code`.

## License

MIT
