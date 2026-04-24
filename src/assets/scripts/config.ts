import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { type LogLevel, parseLogLevel } from "./logger.ts";

export type Settings = {
	host: string;
	port: number;
	homeDir: string;
	storePath: string;
	encryptionKeyFile: string;
	upstreamBaseUrl: string;
	authBaseUrl: string;
	oauthClientId: string;
	oauthScope: string;
	tokenRefreshIntervalDays: number;
	tokenRefreshTimeoutSeconds: number;
	proxyRequestBudgetSeconds: number;
	apiKeyAuthEnabled: boolean;
	codexAuthDir: string | null;
	logLevel: LogLevel;
};

// 1. Settings load ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function loadSettings(): Settings {
	const homeDir = expandPath(readEnv("CODEX_LB_HOME", "~/.codex-loadbalancer"));
	const codexAuthDir = readOptionalEnv("CODEX_LB_AUTH_DIR");
	return {
		host: readEnv("CODEX_LB_HOST", "127.0.0.1"),
		port: readIntEnv("CODEX_LB_PORT", 5555),
		homeDir,
		storePath: expandPath(
			readEnv("CODEX_LB_STORE_PATH", `${homeDir}/store.json`),
		),
		encryptionKeyFile: expandPath(
			readEnv("CODEX_LB_ENCRYPTION_KEY_FILE", `${homeDir}/encryption.key`),
		),
		upstreamBaseUrl: readEnv(
			"CODEX_LB_UPSTREAM_BASE_URL",
			"https://chatgpt.com/backend-api/codex",
		),
		authBaseUrl: readEnv("CODEX_LB_AUTH_BASE_URL", "https://auth.openai.com"),
		oauthClientId: readEnv(
			"CODEX_LB_OAUTH_CLIENT_ID",
			"app_EMoamEEZ73f0CkXaXp7hrann",
		),
		oauthScope: readEnv("CODEX_LB_OAUTH_SCOPE", "openid profile email"),
		tokenRefreshIntervalDays: readIntEnv(
			"CODEX_LB_TOKEN_REFRESH_INTERVAL_DAYS",
			8,
		),
		tokenRefreshTimeoutSeconds: readFloatEnv(
			"CODEX_LB_TOKEN_REFRESH_TIMEOUT_SECONDS",
			8,
		),
		proxyRequestBudgetSeconds: readFloatEnv(
			"CODEX_LB_PROXY_REQUEST_BUDGET_SECONDS",
			600,
		),
		apiKeyAuthEnabled: readBoolEnv("CODEX_LB_API_KEY_AUTH_ENABLED", false),
		codexAuthDir: codexAuthDir === null ? null : expandPath(codexAuthDir),
		logLevel: parseLogLevel(readOptionalEnv("CODEX_LB_LOG_LEVEL"), "info"),
	};
}

// 2. Encryption key ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export async function ensureEncryptionKey(settings: Settings): Promise<Buffer> {
	try {
		const existing = (
			await readFile(settings.encryptionKeyFile, "utf8")
		).trim();
		return Buffer.from(existing, "base64");
	} catch {
		const key = randomBytes(32);
		await mkdir(dirname(settings.encryptionKeyFile), { recursive: true });
		await writeFile(settings.encryptionKeyFile, key.toString("base64"), {
			mode: 0o600,
		});
		return key;
	}
}

// 3. Path expand ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function expandPath(value: string): string {
	if (value === "~") {
		return homedir();
	}
	if (value.startsWith("~/") || value.startsWith("~\\")) {
		return resolve(homedir(), value.slice(2));
	}
	return resolve(value);
}

// 4. Env helpers ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// 4-1. Required env
function readEnv(name: string, fallback: string): string {
	return process.env[name]?.trim() || fallback;
}

// 4-2. Optional env
function readOptionalEnv(name: string): string | null {
	const value = process.env[name]?.trim();
	return value ? value : null;
}

// 4-3. Integer env
function readIntEnv(name: string, fallback: number): number {
	const parsed = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// 4-4. Float env
function readFloatEnv(name: string, fallback: number): number {
	const parsed = Number.parseFloat(process.env[name] ?? "");
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// 4-5. Boolean env
function readBoolEnv(name: string, fallback: boolean): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (raw === undefined || raw === "") {
		return fallback;
	}
	return ["1", "true", "yes", "on"].includes(raw);
}
