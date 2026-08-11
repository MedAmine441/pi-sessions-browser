import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let agentDir: string;
let config: typeof import("./pi-config");
const originalAgentDir = process.env.PI_AGENT_DIR;

beforeEach(async () => {
  agentDir = await fs.mkdtemp(join(tmpdir(), "pi-agent-"));
  process.env.PI_AGENT_DIR = agentDir;
  vi.resetModules();
  config = await import("./pi-config");
});

afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = originalAgentDir;
});

describe("pi auth store", () => {
  it("stores and removes API keys in pi's own auth.json shape", async () => {
    await config.loginWithApiKey("anthropic", "  sk-test-123  ");

    const authPath = join(agentDir, "auth.json");
    const auth = JSON.parse(await fs.readFile(authPath, "utf8"));
    expect(auth.anthropic).toEqual({ type: "api_key", key: "sk-test-123" });
    // It's a secrets file: owner-only.
    expect((await fs.stat(authPath)).mode & 0o777).toBe(0o600);

    const state = await config.getPiState();
    expect(state.accounts).toEqual([{ provider: "anthropic", type: "api_key" }]);
    // Status reporting must never leak the key itself.
    expect(JSON.stringify(state)).not.toContain("sk-test-123");

    await config.logout("anthropic");
    expect(JSON.parse(await fs.readFile(authPath, "utf8"))).toEqual({});
    await expect(config.logout("anthropic")).rejects.toThrow(
      "No stored credentials",
    );
  });

  it("leaves other providers' credentials untouched", async () => {
    await fs.writeFile(
      join(agentDir, "auth.json"),
      JSON.stringify({
        "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 1 },
      }),
    );
    await config.loginWithApiKey("groq", "gsk-1");
    await config.logout("groq");
    const auth = JSON.parse(await fs.readFile(join(agentDir, "auth.json"), "utf8"));
    expect(auth["openai-codex"]).toMatchObject({ type: "oauth" });
  });

  it("rejects malformed provider ids and empty keys", async () => {
    await expect(config.loginWithApiKey("../evil", "k")).rejects.toThrow(
      "provider id",
    );
    await expect(config.loginWithApiKey("anthropic", "   ")).rejects.toThrow(
      "API key",
    );
  });
});

describe("pi model settings", () => {
  it("sets the default model while preserving pi's other settings", async () => {
    await fs.writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ theme: "dark", lastChangelogVersion: "0.84.1" }),
    );

    await config.setDefaultModel("moonshotai", "kimi-k2-thinking", "high");

    const settings = JSON.parse(
      await fs.readFile(join(agentDir, "settings.json"), "utf8"),
    );
    expect(settings).toMatchObject({
      theme: "dark",
      lastChangelogVersion: "0.84.1",
      defaultProvider: "moonshotai",
      defaultModel: "kimi-k2-thinking",
      defaultThinkingLevel: "high",
    });

    await expect(
      config.setDefaultModel("moonshotai", "kimi-k2.5", "ultra"),
    ).rejects.toThrow("thinking level");
  });

  it("lists models from pi's models-store.json without secrets", async () => {
    await fs.writeFile(
      join(agentDir, "models-store.json"),
      JSON.stringify({
        "openai-codex": {
          models: [
            { id: "gpt-5.5", name: "GPT-5.5", reasoning: true, maxTokens: 128000 },
          ],
        },
      }),
    );
    const state = await config.getPiState();
    expect(state.models).toEqual([
      { provider: "openai-codex", id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
    ]);
  });
});
