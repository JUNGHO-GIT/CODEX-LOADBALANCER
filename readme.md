# codex-loadbalancer

`codex-loadbalancer` is a Bun-based local proxy for Codex and OpenAI-compatible clients.
It stores copied ChatGPT account tokens in an encrypted local JSON store, selects the best
available account for each request, refreshes tokens when needed, and forwards traffic to
the Codex backend API.

Korean documentation: [readme.ko.md](readme.ko.md)

## Status

This package is backend-first. It includes the proxy server, local account import, account
selection, token refresh, usage-aware cooldown state, JSON logging, and focused tests.

It does not include a dashboard, OAuth callback UI, database migrations, multi-replica
coordination, or audit screens.

## Requirements

- Bun `1.3.0` or newer
- Local ChatGPT/Codex auth JSON files, or account tokens supplied through the local API
- Optional API key hashes in the local store when proxy authentication is enabled

## Install

```bash
bun add @jungho/codex-loadbalancer
```

For one-off execution:

```bash
bunx @jungho/codex-loadbalancer
```

Global npm install:

```bash
npm install -g @jungho/codex-loadbalancer
```

From a cloned repository:

```bash
bun install
bun run build
bun run check
bun test
bun start
```

Default server:

```text
http://127.0.0.1:58557
```

## Quick Start

Copy Codex auth JSON files into a local directory and point the server at that directory:

```powershell
Copy-Item -LiteralPath "$HOME\.codex\auth" -Destination ".\auth" -Recurse
$env:CODEX_LB_AUTH_DIR = "$PWD\auth"
codex-loadbalancer
```

The server imports `.json` files from `CODEX_LB_AUTH_DIR` into the encrypted local store.
Repeated imports update the same stable account IDs instead of creating duplicates.

## Proxy Targets

Point Codex/OpenAI-compatible clients at either route family:

```text
http://127.0.0.1:58557/backend-api/codex
http://127.0.0.1:58557/v1
```

The proxy preserves the incoming request path after those prefixes and forwards the request
with the selected account access token.

## Account API

List imported accounts:

```bash
curl http://127.0.0.1:58557/api/accounts
```

Create or update an account manually:

```bash
curl -X POST http://127.0.0.1:58557/api/accounts \
  -H "content-type: application/json" \
  -d "{\"email\":\"me@example.com\",\"accessToken\":\"...\",\"refreshToken\":\"...\",\"idToken\":\"...\"}"
```

Stored tokens are encrypted with the local key at `CODEX_LB_ENCRYPTION_KEY_FILE`.
Account metadata and API key hashes live in `CODEX_LB_STORE_PATH`.

## Proxy Authentication

By default, local proxy API key checks are disabled.

Enable them with:

```text
CODEX_LB_API_KEY_AUTH_ENABLED=true
```

Then send:

```text
Authorization: Bearer sk-clb-...
```

The server compares the SHA-256 hash of the bearer token with enabled entries in
`store.json`.

## Routing Behavior

- Active accounts are ranked by cooldown state, usage percentage, and last selection time.
- The primary account is attempted first.
- If the primary account is rate limited, remaining candidates race in parallel.
- `401` responses trigger a forced token refresh and one retry for that account.
- Rate-limit responses update account cooldown state from response headers or JSON payloads.
- Permanently invalid refresh tokens deactivate the affected account.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_LB_HOST` | `127.0.0.1` | Bind host |
| `CODEX_LB_PORT` | `58557` | Bind port |
| `CODEX_LB_HOME` | `~/.codex-loadbalancer` | Runtime home |
| `CODEX_LB_STORE_PATH` | `$CODEX_LB_HOME/store.json` | Account and API key store |
| `CODEX_LB_ENCRYPTION_KEY_FILE` | `$CODEX_LB_HOME/encryption.key` | Local token encryption key |
| `CODEX_LB_AUTH_DIR` | unset | Directory of copied Codex auth JSON files |
| `CODEX_LB_UPSTREAM_BASE_URL` | `https://chatgpt.com/backend-api/codex` | Codex upstream base URL |
| `CODEX_LB_AUTH_BASE_URL` | `https://auth.openai.com` | OAuth token refresh base URL |
| `CODEX_LB_TOKEN_REFRESH_INTERVAL_DAYS` | `8` | Normal refresh interval |
| `CODEX_LB_TOKEN_REFRESH_TIMEOUT_SECONDS` | `8` | Refresh request timeout |
| `CODEX_LB_PROXY_REQUEST_BUDGET_SECONDS` | `600` | Proxy request budget |
| `CODEX_LB_PROXY_MAX_BODY_BYTES` | `10485760` | Maximum proxy request body size |
| `CODEX_LB_USAGE_POLL_CONCURRENCY` | `2` | Usage polling account concurrency |
| `CODEX_LB_USAGE_POLL_JITTER_MS` | `5000` | Usage polling retry jitter |
| `CODEX_LB_API_KEY_AUTH_ENABLED` | `false` | Local proxy bearer-token gate |
| `CODEX_LB_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, or `silent` |
| `CODEX_LB_LOG_FILE` | `$CODEX_LB_HOME/proxy.log` | File sink for JSON logs |

## Logging

Logs are newline-delimited JSON. Token-like fields are redacted before emission.

Set debug logging when tracing account selection, upstream calls, and route flow:

```powershell
$env:CODEX_LB_LOG_LEVEL = "debug"
```

## Project Layout

```text
src/assets/scripts/       config, encryption, structured logger
src/assets/type/domain/   shared domain and payload types
src/repositories/         encrypted JSON store facade
src/services/             account import, token refresh, routing, proxy, usage
src/routers/              HTTP routing and request logging
src/index.ts              process bootstrap and server start
tests/                    focused behavior tests
```

## More Documentation

- [architecture.md](architecture.md)
- [architecture.ko.md](architecture.ko.md)
