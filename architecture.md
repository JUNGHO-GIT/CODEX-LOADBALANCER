# codex-loadbalancer Architecture

Korean version: [architecture.ko.md](architecture-ko.md)

## System Map

```text
Codex/OpenAI client
        |
        | HTTP
        v
src/index.ts
        |
        v
src/routers/server.ts
        |
        +--> /health/live
        |
        +--> /api/accounts
        |        |
        |        v
        |   src/services/auth.ts
        |        |
        |        v
        |   src/repositories/store.ts
        |
        +--> /backend-api/codex/* and /v1/*
                 |
                 v
            src/services/proxy.ts
                 |
                 +--> src/services/balancer.ts
                 +--> src/services/auth.ts
                 +--> src/repositories/store.ts
                 |
                 v
            ChatGPT Codex upstream
```

## Runtime Responsibilities

| Area | File | Responsibility |
| --- | --- | --- |
| Bootstrap | `src/index.ts` | Load settings, create logger, load store, import auth files, start server |
| Configuration | `src/assets/scripts/config.ts` | Resolve environment variables, runtime paths, and encryption key location |
| Logging | `src/assets/scripts/logger.ts` | Emit structured JSON logs with redaction |
| HTTP routes | `src/routers/server.ts` | Route health, account API, and proxy traffic |
| Store | `src/repositories/store.ts` | Read-through JSON cache with debounced atomic persistence |
| Account import | `src/services/codex-auth.ts` | Convert copied Codex auth JSON files into stable local accounts |
| Token lifecycle | `src/services/auth.ts` | Create encrypted account records and refresh access tokens |
| Load balancing | `src/services/balancer.ts` | Rank active accounts by cooldown, usage, and rotation |
| Proxy | `src/services/proxy.ts` | Authenticate local API keys, choose accounts, retry refresh, forward responses |
| Usage | `src/services/usage.ts` | Fetch and apply upstream usage windows |

## Request Flow

```text
1. Client sends request to /backend-api/codex/* or /v1/*.
2. server.ts attaches a request-scoped logger and calls proxyRequest().
3. proxy.ts validates the optional local bearer token.
4. Store returns the current account list from memory.
5. balancer.ts ranks active accounts.
6. proxy.ts sends the request with the selected account access token.
7. A successful upstream response is streamed back to the client.
8. A rate-limited primary account updates cooldown state, then remaining accounts race.
9. A 401 response forces token refresh and retries the same account once.
10. Final success, rate-limit, or upstream failure is written in OpenAI-compatible shape.
```

## Account Import Flow

```text
CODEX_LB_AUTH_DIR
        |
        v
codex-auth.ts
        |
        +--> read *.json files
        +--> extract access_token, refresh_token, id_token, account_id
        +--> derive stable account ID from file name
        +--> encrypt tokens
        v
store.ts
        |
        v
store.json
```

Import is idempotent because the account ID is derived from the auth file name.

## Store Model

The store is local JSON with this top-level shape:

```json
{
  "accounts": [],
  "apiKeys": []
}
```

`store.ts` hydrates the file once, serves request-path reads from memory, schedules delayed
flushes after writes, and persists by writing a temporary file followed by atomic rename.

Token fields are encrypted before they enter the store. API keys are stored as SHA-256 hashes.

## Selection Model

```text
active account set
        |
        v
rank by:
  1. no active cooldown before active cooldown
  2. lower secondary or primary usage percentage
  3. older lastSelectedAt
        |
        v
primary attempt
        |
        +--> success: record success and stream response
        +--> 401: refresh token and retry once
        +--> 429: mark cooldown and race remaining accounts
        +--> error: record transient error and try remaining accounts
```

Free-plan and token-exhausted accounts are excluded from the balancer until their usage window
resets. Cooled-down accounts are demoted, not removed, so the proxy can still attempt them when
no better candidate exists.

## Security Boundaries

- Token plaintext is only needed during import, refresh, and upstream request dispatch.
- Stored access, refresh, and ID tokens are encrypted with a local 32-byte key.
- Local proxy API keys are optional and stored only as hashes.
- Logs redact token-like fields before writing to console or file sinks.
- Runtime files such as `store.json` and `encryption.key` are not part of the npm package.

## Package Boundary

The npm package publishes only the Bun entrypoint, bundled runtime, and documentation:

```text
bin/
dist/
readme.md
readme.ko.md
architecture.md
architecture.ko.md
changelog.md
license.md
```

Local runtime artifacts, tests, client assets, caches, stores, and encryption keys stay outside the package.

## Validation Surface

The current focused checks are:

```bash
bun run build
bun run check
bun test
npm pack --dry-run
```

`bun run build` validates the bundled Bun entrypoint. `bun run check` validates TypeScript.
`bun test` covers account ranking, auth import, and proxy fallback behavior. `npm pack --dry-run`
verifies the publish file list.
