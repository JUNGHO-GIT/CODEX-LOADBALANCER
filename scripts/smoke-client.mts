const clientBaseUrl = process.env.CODEX_LB_CLIENT_SMOKE_URL ?? "http://127.0.0.1:59176";
const backendBaseUrl = process.env.CODEX_LB_BACKEND_SMOKE_URL ?? "http://127.0.0.1:58557";

type RuntimeSummaryPayload = {
  settings?: {
    preferredHighCapabilityModel?: string;
    fallbackHighCapabilityModel?: string;
  };
  cooldown?: {
    active?: boolean;
  };
};

await assertClientShell();
await assertBackendRuntimeSummary();

console.log(`client smoke ok: ${clientBaseUrl}`);

// 1. Client shell assert
async function assertClientShell(): Promise<void> {
  const response = await fetch(clientBaseUrl);
  if (!response.ok) {
    throw new Error(`Client returned ${response.status}`);
  }
  const html = await response.text();
  if (!html.includes("Codex LB") || !html.includes("/src/main.tsx") || !html.includes("id=\"root\"")) {
    throw new Error("Client shell did not include expected Vite app markers");
  }
}

// 2. Backend runtime assert
async function assertBackendRuntimeSummary(): Promise<void> {
  const response = await fetch(`${backendBaseUrl}/api/runtime-summary`);
  if (!response.ok) {
    throw new Error(`Runtime summary returned ${response.status}`);
  }
  const payload = await response.json() as RuntimeSummaryPayload;
  if (payload.settings?.preferredHighCapabilityModel !== "gpt-5.5") {
    throw new Error("Runtime summary missing preferred model policy");
  }
  if (payload.settings?.fallbackHighCapabilityModel !== "gpt-5.4") {
    throw new Error("Runtime summary missing fallback model policy");
  }
  if (typeof payload.cooldown?.active !== "boolean") {
    throw new Error("Runtime summary missing cooldown status");
  }
}
