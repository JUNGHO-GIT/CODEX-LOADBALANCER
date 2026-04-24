import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Logger } from "../assets/scripts/logger.ts";
import type { Account } from "../assets/type/domain/common.ts";
import type { Store } from "../repositories/store.ts";
import { createAccount } from "./auth.ts";

type CodexAuthPayload = {
	auth_mode?: unknown;
	OPENAI_API_KEY?: unknown;
	tokens?: unknown;
	last_refresh?: unknown;
};

// 1. Codex auth import ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function importCodexAuthDirectory(
	authDir: string,
	store: Store,
	encryptionKey: Buffer,
	logger?: Logger,
): Promise<number> {
	logger?.info("codex_auth.import_started", { authDir });
	const files = await readdir(authDir, { withFileTypes: true });
	let imported = 0;
	for (const file of files) {
		if (!file.isFile() || extname(file.name).toLowerCase() !== ".json") {
			logger?.debug("codex_auth.file_skipped", {
				fileName: file.name,
				reason: "not_json_file",
			});
			continue;
		}
		const account = await readCodexAuthFile(
			join(authDir, file.name),
			file.name,
			encryptionKey,
		);
		if (account === null) {
			logger?.warn("codex_auth.file_skipped", {
				fileName: file.name,
				reason: "missing_token_payload",
			});
			continue;
		}
		await store.upsertAccount(account);
		logger?.info("codex_auth.account_imported", {
			fileName: file.name,
			accountId: account.id,
			chatgptAccountIdPresent: account.chatgptAccountId !== null,
		});
		imported += 1;
	}
	logger?.info("codex_auth.import_completed", { imported });
	return imported;
}

// 2. Auth file read ――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function readCodexAuthFile(
	path: string,
	fileName: string,
	encryptionKey: Buffer,
): Promise<Account | null> {
	const payload = parsePayload(await readFile(path, "utf8"));
	if (payload === null) {
		return null;
	}
	return accountFromPayload(payload, fileName, encryptionKey);
}

// 3. Account map ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function accountFromPayload(
	payload: CodexAuthPayload,
	fileName: string,
	encryptionKey: Buffer,
): Account | null {
	const tokens = objectValue(payload.tokens);
	const accessToken = stringValue(tokens?.access_token);
	const refreshToken = stringValue(tokens?.refresh_token);
	const idToken = stringValue(tokens?.id_token);
	if (accessToken === null || refreshToken === null || idToken === null) {
		return null;
	}
	const account = createAccount(
		{
			id: stableAccountId(fileName),
			email: basename(fileName, extname(fileName)),
			accessToken,
			refreshToken,
			idToken,
			chatgptAccountId: stringValue(tokens?.account_id),
		},
		encryptionKey,
	);
	return {
		...account,
		lastRefresh: stringValue(payload.last_refresh) ?? account.lastRefresh,
	};
}

// 4. Payload parse ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function parsePayload(text: string): CodexAuthPayload | null {
	try {
		const parsed = JSON.parse(text) as unknown;
		return objectValue(parsed) as CodexAuthPayload | null;
	} catch {
		return null;
	}
}

// 5. Value helpers ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 5-1. Stable account id
function stableAccountId(fileName: string): string {
	const raw = basename(fileName, extname(fileName));
	const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, "_") || "default";
	return `codex-auth-${safe}`;
}

// 5-2. Object value
function objectValue(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

// 5-3. String value
function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}
