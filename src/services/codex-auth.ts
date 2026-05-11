import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Logger } from "../assets/scripts/logger.ts";
import type { Account } from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";
import {
  applyAccountPlanPolicy,
  extractAccountIdentity,
} from "./account-policy.ts";
import { createAccount } from "./auth.ts";

type CodexAuthPayload = {
  auth_mode?: unknown;
  OPENAI_API_KEY?: unknown;
  tokens?: unknown;
  last_refresh?: unknown;
};

type AuthFile = {
  path: string;
  fileName: string;
};

// 1. Codex auth import ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function importCodexAuthDirectory(authDir: string, store: Store, encryptionKey: Buffer, autoDisableFreePlan: boolean, logger?: Logger): Promise<number> {
  logger?.info("codex_auth.import_started", { authDir });
  const files = await listAuthFiles(authDir, logger);
  let imported = 0;
  for (const file of files) {
    const account = await readCodexAuthFile(
      file.path,
      file.fileName,
      encryptionKey,
      autoDisableFreePlan,
    );
    if (account === null) {
      logger?.warn("codex_auth.file_skipped", {
        fileName: file.fileName,
        reason: "missing_token_payload",
      });
      continue;
    }
    const merged = mergeImportedAccount(await store.getAccount(account.id), account);
    await store.upsertAccount(merged);
    logger?.info("codex_auth.account_imported", {
      fileName: file.fileName,
      accountId: merged.id,
      accountName: merged.email ?? merged.id,
      chatgptAccountIdPresent: merged.chatgptAccountId !== null,
    });
    imported += 1;
  }
  logger?.info("codex_auth.import_completed", { imported });
  return imported;
}

// 1-1. Auth files list
async function listAuthFiles(authPath: string, logger?: Logger): Promise<AuthFile[]> {
  const info = await stat(authPath);
  if (info.isFile()) {
    if (extname(authPath).toLowerCase() !== ".json") {
      logger?.debug("codex_auth.file_skipped", {
        fileName: basename(authPath),
        reason: "not_json_file",
      });
      return [];
    }
    return [{ path: authPath, fileName: basename(authPath) }];
  }
  const files = await readdir(authPath, { withFileTypes: true });
  const jsonFiles: AuthFile[] = [];
  for (const file of files) {
    if (!file.isFile() || extname(file.name).toLowerCase() !== ".json") {
      logger?.debug("codex_auth.file_skipped", {
        fileName: file.name,
        reason: "not_json_file",
      });
      continue;
    }
    jsonFiles.push({ path: join(authPath, file.name), fileName: file.name });
  }
  if (jsonFiles.length > 0) {
    return jsonFiles;
  }
  if (basename(authPath).toLowerCase() !== "auth") {
    return [];
  }
  const siblingAuthFile = join(dirname(authPath), "auth.json");
  if (!(await fileExists(siblingAuthFile))) {
    return [];
  }
  logger?.info("codex_auth.sibling_file_detected", {
    authFile: siblingAuthFile,
  });
  return [{ path: siblingAuthFile, fileName: "auth.json" }];
}

// 1-2. File exists
async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  }
  catch {
    return false;
  }
}

// 2. Auth file read ――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function readCodexAuthFile(path: string, fileName: string, encryptionKey: Buffer, autoDisableFreePlan: boolean): Promise<Account | null> {
  const payload = parsePayload(await readFile(path, "utf8"));
  if (payload === null) {
    return null;
  }
  return accountFromPayload(payload, fileName, encryptionKey, autoDisableFreePlan);
}

// 3. Account map ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function accountFromPayload(payload: CodexAuthPayload, fileName: string, encryptionKey: Buffer, autoDisableFreePlan: boolean): Account | null {
  const tokens = objectValue(payload.tokens);
  const accessToken = stringValue(tokens?.access_token);
  const refreshToken = stringValue(tokens?.refresh_token);
  const idToken = stringValue(tokens?.id_token);
  if (accessToken === null || refreshToken === null || idToken === null) {
    return null;
  }
  const identity = extractAccountIdentity({ accessToken, idToken });
  const account = createAccount(
    {
      id: stableAccountId(fileName),
      email: identity.email ?? basename(fileName, extname(fileName)),
      accessToken,
      refreshToken,
      idToken,
      chatgptAccountId: identity.chatgptAccountId ?? stringValue(tokens?.account_id),
      planType: identity.planType,
    },
    encryptionKey,
  );
  return applyAccountPlanPolicy({
    ...account,
    lastRefresh: stringValue(payload.last_refresh) ?? account.lastRefresh,
  }, autoDisableFreePlan);
}

// 4. Imported account merge ―――――――――――――――――――――――――――――――――――――――――――――――
function mergeImportedAccount(existing: Account | null, imported: Account): Account {
  if (existing === null) {
    return imported;
  }
  if (refreshTimestamp(imported.lastRefresh) < refreshTimestamp(existing.lastRefresh)) {
    return existing;
  }
  return {
    ...imported,
    supportedModelIds: existing.supportedModelIds,
    unsupportedModelIds: existing.unsupportedModelIds,
    usedPercent: existing.usedPercent,
    secondaryUsedPercent: existing.secondaryUsedPercent,
    resetAt: existing.resetAt,
    cooldownUntil: existing.cooldownUntil,
    lastSelectedAt: existing.lastSelectedAt,
    errorCount: existing.errorCount,
    lastErrorAt: existing.lastErrorAt,
  };
}

// 4-1. Refresh timestamp
function refreshTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// 5. Payload parse ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function parsePayload(text: string): CodexAuthPayload | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return objectValue(parsed) as CodexAuthPayload | null;
  } catch {
    return null;
  }
}

// 6. Value helpers ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 6-1. Stable account id
function stableAccountId(fileName: string): string {
  const raw = basename(fileName, extname(fileName));
  const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, "_") || "default";
  return `codex-auth-${safe}`;
}

// 6-2. Object value
function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

// 6-3. String value
function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
