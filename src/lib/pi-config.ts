import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * The UI counterparts of pi's /login, /logout, and /model commands drive the
 * same files pi itself reads (verified against pi 0.84.1):
 *
 *   ~/.pi/agent/auth.json         one credential per provider —
 *                                 {type:"api_key", key} | {type:"oauth", …}
 *   ~/.pi/agent/settings.json     defaultProvider / defaultModel /
 *                                 defaultThinkingLevel for new sessions
 *   ~/.pi/agent/models-store.json models fetched per authenticated provider
 *
 * OAuth logins are interactive PKCE/device flows owned by pi's TUI, so the
 * "account" path opens a terminal running pi rather than reimplementing them.
 */
const agentDir = resolve(
  process.env.PI_AGENT_DIR || `${homedir()}/.pi/agent`,
);
const terminal = process.env.PI_TERMINAL || "x-terminal-emulator";
const piCommand = process.env.PI_COMMAND || "pi";

const authPath = resolve(agentDir, "auth.json");
const settingsPath = resolve(agentDir, "settings.json");
const modelsStorePath = resolve(agentDir, "models-store.json");

/** Providers whose /login flow is OAuth (from pi-ai's auth/oauth modules). */
export const OAUTH_PROVIDERS = [
  "anthropic",
  "github-copilot",
  "kimi-coding",
  "openai-codex",
  "openrouter",
  "radius",
];

/** Suggestions for the API-key form; pi accepts any provider id it knows. */
export const KNOWN_PROVIDERS = [
  "anthropic",
  "cerebras",
  "deepseek",
  "fireworks",
  "google",
  "groq",
  "minimax",
  "mistral",
  "moonshotai",
  "openai",
  "openrouter",
  "together",
  "xai",
  "zai",
];

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

type Credential =
  | { type: "api_key"; key?: string; env?: Record<string, string> }
  | { type: "oauth"; access?: string; refresh?: string; expires?: number };

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Credentials rewrite: atomic and owner-only, it's a secrets file. */
async function writeAuth(auth: Record<string, Credential>) {
  await fs.mkdir(dirname(authPath), { recursive: true });
  const temp = `${authPath}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temp, JSON.stringify(auth, null, 1) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.rename(temp, authPath);
}

function assertProviderId(provider: unknown): asserts provider is string {
  if (typeof provider !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(provider))
    throw new Error("That is not a valid provider id.");
}

export type PiModel = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
};

type ModelsStore = Record<
  string,
  {
    models?: {
      id: string;
      name?: string;
      reasoning?: boolean;
      contextWindow?: number;
    }[];
  }
>;
type Settings = Record<string, unknown> & {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
};

/** Everything the sidebar needs in one read. Never includes secrets. */
export async function getPiState() {
  const auth = (await readJson<Record<string, Credential>>(authPath)) || {};
  const store = (await readJson<ModelsStore>(modelsStorePath)) || {};
  const settings = (await readJson<Settings>(settingsPath)) || {};

  const models: PiModel[] = [];
  for (const [provider, entry] of Object.entries(store)) {
    for (const model of entry?.models || []) {
      if (model?.id)
        models.push({
          provider,
          id: model.id,
          name: model.name,
          reasoning: model.reasoning,
        });
    }
  }

  return {
    accounts: Object.entries(auth).map(([provider, credential]) => ({
      provider,
      type: credential?.type === "oauth" ? ("oauth" as const) : ("api_key" as const),
    })),
    oauthProviders: OAUTH_PROVIDERS,
    knownProviders: KNOWN_PROVIDERS,
    thinkingLevels: THINKING_LEVELS,
    models,
    settings: {
      defaultProvider: settings.defaultProvider ?? null,
      defaultModel: settings.defaultModel ?? null,
      defaultThinkingLevel: settings.defaultThinkingLevel ?? null,
    },
  };
}

export async function loginWithApiKey(provider: string, key: string) {
  assertProviderId(provider);
  if (typeof key !== "string" || !key.trim())
    throw new Error("An API key is required.");
  const auth = (await readJson<Record<string, Credential>>(authPath)) || {};
  auth[provider] = { type: "api_key", key: key.trim() };
  await writeAuth(auth);
}

export async function logout(provider: string) {
  assertProviderId(provider);
  const auth = (await readJson<Record<string, Credential>>(authPath)) || {};
  if (!(provider in auth))
    throw new Error(`No stored credentials for ${provider}.`);
  delete auth[provider];
  await writeAuth(auth);
}

export async function setDefaultModel(
  provider: string,
  modelId: string,
  thinkingLevel?: string,
) {
  assertProviderId(provider);
  if (typeof modelId !== "string" || !modelId.trim())
    throw new Error("A model id is required.");
  if (thinkingLevel !== undefined && !THINKING_LEVELS.includes(thinkingLevel))
    throw new Error("That is not a valid thinking level.");
  // Preserve every key pi keeps in settings.json; only touch the defaults.
  const settings = (await readJson<Settings>(settingsPath)) || {};
  settings.defaultProvider = provider;
  settings.defaultModel = modelId.trim();
  if (thinkingLevel !== undefined) settings.defaultThinkingLevel = thinkingLevel;
  await fs.mkdir(dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 1) + "\n", "utf-8");
}

/**
 * OAuth flows (PKCE, device codes) are pi's own interactive machinery, so
 * account login happens in a real terminal running pi. --no-session keeps the
 * visit from leaving an empty session behind.
 */
export async function launchLoginTerminal() {
  const script =
    'printf "\\nType /login to add an account, then /quit when you are done.\\n\\n"; exec "$1" --no-session';
  const child = spawn(
    terminal,
    ["-e", "bash", "-lc", script, "pi-sessions-browser", piCommand],
    { detached: true, stdio: "ignore", env: process.env },
  );
  child.once("error", (error) =>
    console.error(`Could not launch ${terminal}: ${error.message}`),
  );
  child.unref();
}
