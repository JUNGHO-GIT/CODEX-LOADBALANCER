/**
 * @file index.ts
 * @description foo
 * @author Jungho
 * @since 2026-4-25
 */

import { createWriteStream as crtWrtStrm, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ensureEncryptionKey as ensrEncrKy, loadSettings } from "@assets/scripts/config.ts";
import { createLogger, errorContext } from "@assets/scripts/logger.ts";
import { createStore } from "@repositories/store.ts";
import { createLoadBalancerServer as crtLdBalSrvr } from "@routers/server.ts";
import { reconcileAccountPolicies as rcncAcctPlcs } from "@services/account-policy.ts";
import { importCodexAuthDirectory as impCdAtDi } from "@services/codex-auth.ts";
import { startUsagePolling as strtUsgPlln } from "@services/usage.ts";

// 0. File sink ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function createTeeSink(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const ansi = /\[[0-9;]*m/g;
  const stream = crtWrtStrm(filePath, { flags: "a" });
  stream.on("error", () => undefined);
  const write = (line: string) => {
    try {
      if (!stream.destroyed) {
        stream.write(`${line.replace(ansi, "")}\n`);
      }
    } catch {}
  };
  return {
    debug(line: string) {
      console.debug(line);
      write(line);
    },
    info(line: string) {
      console.info(line);
      write(line);
    },
    log(line: string) {
      console.log(line);
      write(line);
    },
    warn(line: string) {
      console.warn(line);
      write(line);
    },
    error(line: string) {
      console.error(line);
      write(line);
    },
  };
}

// 1. Main ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
async function main(): Promise<void> {
  const settings = loadSettings();
  const logFilePath =
    process.env.CODEX_LB_LOG_FILE?.trim() || `${settings.homeDir}/proxy.log`;
  const sink = createTeeSink(logFilePath);
  const logger = createLogger(settings.logLevel, {}, sink);
  logger.info("log.file_sink", { logFilePath });
  logger.info("app.starting", {
    host: settings.host,
    port: settings.port,
    logLevel: settings.logLevel,
    storePath: settings.storePath,
    apiKeyAuthEnabled: settings.apiKeyAuthEnabled,
    codexAuthImportEnabled: settings.codexAuthDir !== null,
    autoDisableFreePlan: settings.autoDisableFreePlan,
  });
  const encrKy = await ensrEncrKy(settings);
  const store = createStore(settings.storePath);
  if (settings.codexAuthDir !== null) {
    const imported = await impCdAtDi(
      settings.codexAuthDir,
      store,
      encrKy,
      settings.autoDisableFreePlan,
      logger,
    );
    logger.info("codex_auth.import_finished", { imported });
  }
  const plcyUpdt = await rcncAcctPlcs(store, settings);
  logger.info("account_policy.reconciled", { updatedCount: plcyUpdt });
  const server = crtLdBalSrvr({
    settings,
    encryptionKey: encrKy,
    store,
    logger,
    upstreamBase: settings.upstreamBaseUrl.replace(/\/$/, ""),
  });
  server.listen(settings.port, settings.host, () => {
    logger.info("server.listening", {
      url: `http://${settings.host}:${settings.port}`,
    });
  });
  strtUsgPlln(store, settings, encrKy, logger);
  logger.info("usage_poll.scheduled", {
    intervalSeconds: settings.usagePollIntervalSeconds,
  });
}
main().catch((error: unknown) => {
  const logger = createLogger("error");
  logger.error("app.failed", errorContext(error));
  process.exitCode = 1;
});
