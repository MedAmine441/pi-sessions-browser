import { describe, expect, it } from "vitest";
import { aggregateStats } from "./stats";
import type { SessionInfo } from "@/types";

function session(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    file: "/root/--work--/2026-08-10T10-00-00-000Z_a.jsonl",
    id: "a",
    name: null,
    cwd: "/work",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:05:00.000Z",
    messageCount: 4,
    preview: "",
    size: 100,
    cost: 0.5,
    inputTokens: 1000,
    outputTokens: 200,
    hasError: false,
    model: { provider: "anthropic", modelId: "claude-opus-4-6" },
    ...overrides,
  };
}

describe("aggregateStats", () => {
  it("buckets sessions by day, model, and folder with summed usage", () => {
    const stats = aggregateStats([
      session({}),
      session({
        file: "/root/--work--/2026-08-10T12-00-00-000Z_b.jsonl",
        id: "b",
        cost: 0.25,
        inputTokens: 500,
        outputTokens: 100,
        messageCount: 2,
      }),
      session({
        file: "/root/--other--/2026-08-11T09-00-00-000Z_c.jsonl",
        id: "c",
        cwd: "/other",
        cost: 2,
        model: { provider: "openai-codex", modelId: "gpt-5.6-terra" },
      }),
      session({
        file: "/root/--other--/no-timestamp.jsonl",
        id: "d",
        cwd: "/other",
        cost: 0,
        model: null,
      }),
    ]);

    expect(stats.totals).toEqual({
      sessions: 4,
      messages: 14,
      cost: 2.75,
      inputTokens: 3500,
      outputTokens: 700,
    });

    // Days are chronological; the timestampless file counts in totals but
    // has no day to live under.
    expect(stats.perDay.map((b) => [b.key, b.sessions, b.cost])).toEqual([
      ["2026-08-10", 2, 0.75],
      ["2026-08-11", 1, 2],
    ]);

    // Models and folders sort by cost.
    expect(stats.perModel.map((b) => b.key)).toEqual([
      "openai-codex/gpt-5.6-terra",
      "anthropic/claude-opus-4-6",
      "unknown",
    ]);
    expect(stats.perFolder.map((b) => [b.key, b.sessions])).toEqual([
      ["/other", 2],
      ["/work", 2],
    ]);
  });

  it("returns zeroed totals for an empty store", () => {
    const stats = aggregateStats([]);
    expect(stats.totals.sessions).toBe(0);
    expect(stats.perDay).toEqual([]);
    expect(stats.perModel).toEqual([]);
    expect(stats.perFolder).toEqual([]);
  });
});
