# codex-loadbalancer

TypeScript port seed for `codex-lb`.

This keeps the same process shape as the Python project:

1. Store ChatGPT account tokens in a local encrypted JSON store.
2. Select an active account by status, cooldown, and usage.
3. Refresh stale or expired access tokens.
4. Proxy Codex/OpenAI-compatible traffic through `/backend-api/codex/*` and `/v1/*`.
5. Fetch usage from `/backend-api/wham/usage` and feed routing state.

It is intentionally backend-first. Dashboard, OAuth callback UI, database migrations,
multi-replica bridge, and audit screens are not copied yet.

## Run

```bash
bun install
bun run check
bun start
```

Default server:

```text
http://127.0.0.1:5555
```

## Structure

```text
src/assets/scripts/       config, encryption, structured logger
src/assets/type/domain/   shared domain and payload types
src/repositories/         JSON store
src/services/             account import, token refresh, account selection, proxying, usage
src/routers/              HTTP routing and request-scoped logging
src/index.ts              process bootstrap
tests/                    focused behavior tests
```

## Logging

Logs are newline-delimited JSON. Use `CODEX_LB_LOG_LEVEL` to control detail:

```text
debug | info | warn | error | silent
```

`debug` includes route, selection, upstream request, and upstream response details.
Token-like fields are redacted before emission.

## Add Account

Import copied Codex auth files:

```powershell
Copy-Item -LiteralPath "$HOME\.codex\auth" -Destination ".\auth" -Recurse
$env:CODEX_LB_AUTH_DIR = "$PWD\auth"
bun start
```

Or create/edit `~/.codex-loadbalancer/store.json` through the local API:

```bash
curl -X POST http://127.0.0.1:5555/api/accounts \
  -H "content-type: application/json" \
  -d "{\"email\":\"me@example.com\",\"accessToken\":\"...\",\"refreshToken\":\"...\",\"idToken\":\"...\"}"
```

## Proxy

Point clients at:

```text
http://127.0.0.1:5555/backend-api/codex
http://127.0.0.1:5555/v1
```

If `CODEX_LB_API_KEY_AUTH_ENABLED=true`, send:

```text
Authorization: Bearer sk-clb-...
```

API keys live in `store.json` as SHA-256 hashes.
