import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStore } from "../src/repositories/store.ts";

test("store recovers from the backup file when the primary store is corrupted", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-lb-store-"));
  try {
    const storePath = join(root, "store.json");
    const store = createStore(storePath);
    await store.write({
      accounts: [],
      apiKeys: [],
      meta: {
        globalCooldownUntil: 100,
        globalCooldownReason: "first",
      },
    });
    await store.flush();
    await store.write({
      accounts: [],
      apiKeys: [],
      meta: {
        globalCooldownUntil: 200,
        globalCooldownReason: "second",
      },
    });
    await store.flush();
    await writeFile(storePath, "{", "utf8");

    const recovered = await createStore(storePath).getMeta();

    assert.deepEqual(recovered, {
      globalCooldownUntil: 100,
      globalCooldownReason: "first",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
