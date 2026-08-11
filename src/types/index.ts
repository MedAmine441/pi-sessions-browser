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

export type SessionDetail = {
  file: string;
  id: string;
  name: string | null;
  cwd: string;
  createdAt: string;
  preview: string;
  items: Message[];
};
