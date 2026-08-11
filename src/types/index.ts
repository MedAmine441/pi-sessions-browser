export type SessionInfo = {
  file: string;
  id: string;
  name: string | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
  size: number;
  /** Summed usage.cost.total across every entry that carries usage. */
  cost: number;
  /** True when any assistant message ended in an error. */
  hasError: boolean;
  /** The model the session is currently on (pi's restore rule). */
  model: SessionModel | null;
};

/** One typed content block of a message, in pi's own shapes. */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "toolCall";
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    }
  | { type: "image"; data: string; mimeType?: string };

/** Token and dollar accounting pi stores on assistant messages. */
export type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
};

export type Message = {
  id: string;
  role: string;
  /** Flattened text with placeholders — previews and tree labels. */
  text: string;
  /** Structured content when pi stored an array; the chat renders these. */
  parts?: MessagePart[];
  timestamp?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  /** Tool-specific metadata, e.g. the edit tool's precomputed {diff}. */
  details?: unknown;
  usage?: Usage;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  /** bashExecution entries carry the run itself instead of content. */
  command?: string;
  output?: string;
  exitCode?: number | null;
  cancelled?: boolean;
  truncated?: boolean;
  /** Compaction entries: context size before the squeeze. */
  tokensBefore?: number;
};

export type SessionModel = { provider: string; modelId: string };

export type SessionDetail = {
  file: string;
  id: string;
  name: string | null;
  cwd: string;
  createdAt: string;
  preview: string;
  model?: SessionModel | null;
  items: Message[];
};

/** One /api/search hit: a session summary plus where and what matched. */
export type SearchHit = SessionInfo & {
  snippet: string;
  matchedIn: "name" | "message";
  date: string | null;
};

/** One displayable entry in the /tree view, parented to its nearest peer. */
export type SessionTreeNode = {
  id: string;
  parentId: string | null;
  role: string;
  text: string;
  timestamp?: string;
  toolName?: string;
  active: boolean;
};

export type SessionTree = { nodes: SessionTreeNode[]; leafId: string | null };

/** What /api/pi/state reports about pi's own auth and model settings. */
export type PiAccount = { provider: string; type: "oauth" | "api_key" };
export type PiModel = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
};
export type PiState = {
  accounts: PiAccount[];
  oauthProviders: string[];
  knownProviders: string[];
  thinkingLevels: string[];
  models: PiModel[];
  settings: {
    defaultProvider: string | null;
    defaultModel: string | null;
    defaultThinkingLevel: string | null;
  };
};
