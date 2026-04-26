import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Settings } from "../assets/scripts/config.ts";
import { errorContext, type Logger } from "../assets/scripts/logger.ts";
import type { Store } from "../repositories/store.ts";
import { applyAccountPlanPolicy } from "../services/account-policy.ts";
import { createAccount } from "../services/auth.ts";
import { proxyRequest, writeJson } from "../services/proxy.ts";
import { buildRuntimeSummary } from "../services/runtime-summary.ts";

export type ServerContext = {
  settings: Settings;
  store: Store;
  encryptionKey: Buffer;
  logger: Logger;
  upstreamBase: string;
};

// 1. Server create ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function createLoadBalancerServer(ctx: ServerContext) {
  return createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestLogger = ctx.logger.child({
      requestId: randomUUID(),
      route: `${req.method ?? "GET"} ${requestPath(req)}`,
    });
    requestLogger.info("request.received");
    try {
      await route(req, res, ctx, requestLogger);
      requestLogger.info("request.completed", {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      requestLogger.error("request.failed", {
        statusCode: 500,
        durationMs: Date.now() - startedAt,
        ...errorContext(error),
      });
      if (!res.headersSent) {
        writeJson(res, 500, {
          error: {
            code: "internal_error",
            message: error instanceof Error ? error.message : "Internal server error",
            type: "server_error",
          },
        });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

// 2. Route ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function route(req: IncomingMessage, res: ServerResponse, ctx: ServerContext, logger: Logger): Promise<void> {
  const path = requestPath(req);
  if (req.method === "GET" && path === "/health/live") {
    logger.debug("route.health_live");
    writeJson(res, 200, { status: "ok" });
    return;
  }
  if (req.method === "GET" && path === "/api/accounts") {
    const accounts = (await ctx.store.listAccounts()).map((account) => ({
      ...account,
      accessTokenEncrypted: "<encrypted>",
      refreshTokenEncrypted: "<encrypted>",
      idTokenEncrypted: "<encrypted>",
    }));
    logger.info("accounts.listed", { count: accounts.length });
    writeJson(res, 200, { accounts });
    return;
  }
  if (req.method === "GET" && path === "/api/runtime-summary") {
    const accounts = await ctx.store.listAccounts();
    const meta = await ctx.store.getMeta();
    const summary = buildRuntimeSummary(accounts, ctx.settings, meta);
    logger.info("runtime.summary_built", {
      totalAccounts: summary.counts.totalAccounts,
      activeAccounts: summary.counts.activeAccounts,
      cooldownActive: summary.cooldown.active,
    });
    writeJson(res, 200, summary);
    return;
  }
  if (req.method === "POST" && path === "/api/global-cooldown/clear") {
    const meta = await ctx.store.setMeta({
      globalCooldownUntil: null,
      globalCooldownReason: null,
    });
    const accounts = await ctx.store.listAccounts();
    const summary = buildRuntimeSummary(accounts, ctx.settings, meta);
    logger.info("runtime.global_cooldown_cleared");
    writeJson(res, 200, summary);
    return;
  }
  if (req.method === "POST" && path === "/api/accounts") {
    const input = (await readJson(req)) as {
      email?: string | null;
      accessToken?: string;
      refreshToken?: string;
      idToken?: string;
      chatgptAccountId?: string | null;
      planType?: string | null;
    };
    if (!input.accessToken || !input.refreshToken || !input.idToken) {
      logger.warn("accounts.create_rejected", {
        reason: "missing_required_token",
      });
      writeJson(res, 400, {
        error: "accessToken, refreshToken, idToken required",
      });
      return;
    }
    const account = applyAccountPlanPolicy(createAccount(
      {
        email: input.email ?? null,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        chatgptAccountId: input.chatgptAccountId ?? null,
        planType: input.planType ?? null,
      },
      ctx.encryptionKey,
    ), ctx.settings.autoDisableFreePlan);
    await ctx.store.upsertAccount(account);
    logger.info("accounts.created", {
      accountId: account.id,
      emailPresent: account.email !== null,
      chatgptAccountIdPresent: account.chatgptAccountId !== null,
      status: account.status,
      planType: account.planType,
    });
    writeJson(res, 201, { id: account.id });
    return;
  }
  if (path.startsWith("/v1/") || path.startsWith("/backend-api/codex/")) {
    await proxyRequest(req, res, { ...ctx, logger });
    return;
  }
  logger.warn("route.not_found");
  writeJson(res, 404, { error: "Not Found" });
}

// 3. JSON read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

// 4. Request path ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function requestPath(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}
