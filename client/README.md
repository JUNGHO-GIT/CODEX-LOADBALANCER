# codex-loadbalancer client

Svelte client for the local `codex-loadbalancer` backend.

## Scripts

```bash
bun install
bun run dev
bun run check
bun run build
```

## Backend

The Vite dev server proxies `/api` and `/health` to `http://127.0.0.1:58557`.

Optional environment files follow the sibling client pattern:

```text
.env-development
.env-production
```

Supported keys:

```text
VITE_APP_PUBLIC_URL=/
VITE_APP_SERVER_URL=http://127.0.0.1:58557
```
