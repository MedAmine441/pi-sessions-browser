import type { SessionInfo, SessionStats, StatsBucket } from "@/types";
import { dateKeyOfSessionFile } from "./utils";

function emptyBucket(key: string): StatsBucket {
  return { key, sessions: 0, messages: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
}

function add(
  buckets: Map<string, StatsBucket>,
  key: string,
  session: SessionInfo,
) {
  const bucket = buckets.get(key) ?? emptyBucket(key);
  bucket.sessions += 1;
  bucket.messages += session.messageCount;
  bucket.cost += session.cost;
  bucket.inputTokens += session.inputTokens;
  bucket.outputTokens += session.outputTokens;
  buckets.set(key, bucket);
}

const byCostThenSessions = (a: StatsBucket, b: StatsBucket) =>
  b.cost - a.cost || b.sessions - a.sessions;

/**
 * Rolls session summaries up into the buckets the stats page renders. Days
 * are keyed by the same filename-timestamp rule the timeline groups by, so
 * the two views never disagree about which day a session belongs to.
 */
export function aggregateStats(sessions: SessionInfo[]): SessionStats {
  const perDay = new Map<string, StatsBucket>();
  const perModel = new Map<string, StatsBucket>();
  const perFolder = new Map<string, StatsBucket>();
  const totals = emptyBucket("totals");

  for (const session of sessions) {
    const day = dateKeyOfSessionFile(session.file);
    if (day) add(perDay, day, session);
    const model = session.model
      ? `${session.model.provider}/${session.model.modelId}`
      : "unknown";
    add(perModel, model, session);
    add(perFolder, session.cwd, session);
    totals.sessions += 1;
    totals.messages += session.messageCount;
    totals.cost += session.cost;
    totals.inputTokens += session.inputTokens;
    totals.outputTokens += session.outputTokens;
  }

  return {
    totals: {
      sessions: totals.sessions,
      messages: totals.messages,
      cost: totals.cost,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
    },
    // Days sort chronologically (the canonical keys compare as strings);
    // models and folders sort by what they cost.
    perDay: [...perDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    perModel: [...perModel.values()].sort(byCostThenSessions),
    perFolder: [...perFolder.values()].sort(byCostThenSessions),
  };
}
