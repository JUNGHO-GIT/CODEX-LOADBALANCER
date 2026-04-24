import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	Account,
	ApiKey,
	StoreData,
	StoreMeta,
} from "../assets/type/domain/common.ts";

export type Store = {
	path: string;
	read(): Promise<StoreData>;
	write(data: StoreData): Promise<void>;
	listAccounts(): Promise<Account[]>;
	upsertAccount(account: Account): Promise<Account>;
	listApiKeys(): Promise<ApiKey[]>;
	getMeta(): Promise<StoreMeta>;
	setMeta(meta: StoreMeta): Promise<StoreMeta>;
	flush(): Promise<void>;
};

// 1. Store create ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
// In-memory cache with debounced async flush. Request path only touches RAM;
// persistence runs in the background via atomic rename. A single read-through
// hydrates the cache lazily.
export function createStore(path: string): Store {
	let cache: StoreData | null = null;
	let hydration: Promise<StoreData> | null = null;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let flushing: Promise<void> | null = null;
	let dirty = false;

	const hydrate = async (): Promise<StoreData> => {
		if (cache !== null) {
			return cache;
		}
		if (hydration === null) {
			hydration = readStore(path).then((data) => {
				cache = data;
				return data;
			});
		}
		return hydration;
	};

	const runFlush = async (): Promise<void> => {
		if (flushing !== null) {
			await flushing;
		}
		if (!dirty || cache === null) {
			return;
		}
		const snapshot = cloneData(cache);
		dirty = false;
		flushing = writeStore(path, snapshot).catch(() => {
			dirty = true;
		});
		await flushing;
		flushing = null;
		if (dirty) {
			scheduleFlush();
		}
	};

	const scheduleFlush = (): void => {
		dirty = true;
		if (flushTimer !== null) {
			return;
		}
		flushTimer = setTimeout(() => {
			flushTimer = null;
			void runFlush();
		}, 25);
	};

	return {
		path,
		read: hydrate,
		write: async (data: StoreData) => {
			cache = data;
			scheduleFlush();
		},
		listAccounts: async () => {
			const data = await hydrate();
			return data.accounts;
		},
		upsertAccount: async (account: Account) => {
			const data = await hydrate();
			const index = data.accounts.findIndex((item) => item.id === account.id);
			if (index >= 0) {
				data.accounts[index] = account;
			} else {
				data.accounts.push(account);
			}
			scheduleFlush();
			return account;
		},
		listApiKeys: async () => {
			const data = await hydrate();
			return data.apiKeys;
		},
		getMeta: async () => {
			const data = await hydrate();
			return { ...data.meta };
		},
		setMeta: async (meta: StoreMeta) => {
			const data = await hydrate();
			data.meta = { ...meta };
			scheduleFlush();
			return { ...data.meta };
		},
		flush: async () => {
			if (flushTimer !== null) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}
			await runFlush();
		},
	};
}

// 2. Store read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function readStore(path: string): Promise<StoreData> {
	try {
		const parsed = JSON.parse(
			await readFile(path, "utf8"),
		) as Partial<StoreData>;
		return {
			accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
			apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
			meta: normalizeMeta(parsed.meta),
		};
	} catch {
		return { accounts: [], apiKeys: [], meta: emptyMeta() };
	}
}

// 2-1. Meta normalize ―――――――――――――――――――――――――――――――――――――――――――――――――――――
function normalizeMeta(meta: Partial<StoreMeta> | undefined): StoreMeta {
	if (meta === undefined || meta === null) {
		return emptyMeta();
	}
	const until =
		typeof meta.globalCooldownUntil === "number" &&
		Number.isFinite(meta.globalCooldownUntil)
			? meta.globalCooldownUntil
			: null;
	const reason =
		typeof meta.globalCooldownReason === "string"
			? meta.globalCooldownReason
			: null;
	return { globalCooldownUntil: until, globalCooldownReason: reason };
}

// 2-2. Empty meta
function emptyMeta(): StoreMeta {
	return { globalCooldownUntil: null, globalCooldownReason: null };
}

// 3. Store write ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function writeStore(path: string, data: StoreData): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	await rename(tmp, path);
}

// 4. Data clone ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function cloneData(data: StoreData): StoreData {
	return {
		accounts: data.accounts.map((account) => ({ ...account })),
		apiKeys: data.apiKeys.map((key) => ({ ...key })),
		meta: { ...data.meta },
	};
}
