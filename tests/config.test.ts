import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadSettings } from "../src/assets/scripts/config.ts";

describe("settings", () => {
  it("defaults network upstreams to chatgpt.com domains", () => {
    const previousAuthBaseUrl = process.env.CODEX_LB_AUTH_BASE_URL;
    const previousUpstreamBaseUrl = process.env.CODEX_LB_UPSTREAM_BASE_URL;
    try {
      delete process.env.CODEX_LB_AUTH_BASE_URL;
      delete process.env.CODEX_LB_UPSTREAM_BASE_URL;

      const settings = loadSettings();

      assert.equal(settings.authBaseUrl, "https://chatgpt.com");
      assert.equal(settings.upstreamBaseUrl, "https://chatgpt.com/backend-api/codex");
    } finally {
      if (previousAuthBaseUrl === undefined) {
        delete process.env.CODEX_LB_AUTH_BASE_URL;
      }
      if (previousAuthBaseUrl !== undefined) {
        process.env.CODEX_LB_AUTH_BASE_URL = previousAuthBaseUrl;
      }
      if (previousUpstreamBaseUrl === undefined) {
        delete process.env.CODEX_LB_UPSTREAM_BASE_URL;
      }
      if (previousUpstreamBaseUrl !== undefined) {
        process.env.CODEX_LB_UPSTREAM_BASE_URL = previousUpstreamBaseUrl;
      }
    }
  });
});
