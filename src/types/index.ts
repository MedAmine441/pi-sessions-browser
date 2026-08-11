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
};

export type Message = {
  id: string;
  role: string;
  text: string;
  timestamp?: string;
  toolName?: string;
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
