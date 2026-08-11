/**
 * Dev tool: populates the Pi session root with realistic test sessions that
 * mimic Pi being used from different folders with different providers, so the
 * browser UI can be eyeballed against real-world shapes:
 *
 *   - openai-codex: thinking holds only a summary headline; the reasoning
 *     itself is an encrypted_content blob inside thinkingSignature
 *   - moonshotai (kimi-k2-thinking): full reasoning visible in thinking,
 *     thinkingSignature is the "reasoning_content" marker
 *   - anthropic / kimi-coding: full reasoning visible + opaque signature
 *   - google: visible thinking, thought signatures
 *   plus error stops, compaction, branch summaries, custom & bashExecution
 *   roles, string/image content, renames and cleared names, and an untouched
 *   header-only session that must stay invisible.
 *
 * Shapes verified against real sessions in ~/.pi/agent/sessions, pi 0.84.1's
 * session-manager source, and docs/session-format.md in earendil-works/pi.
 *
 *   node generate_test_sessions.mjs           # create (honors PI_SESSION_DIR)
 *   node generate_test_sessions.mjs --clean   # remove everything it created
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const root =
  process.env.PI_SESSION_DIR || path.join(os.homedir(), ".pi/agent/sessions");
const manifestPath = path.join(root, ".pi-browser-test-sessions.json");

if (process.argv.includes("--clean")) {
  if (!fs.existsSync(manifestPath)) {
    console.log("Nothing to clean: no manifest at", manifestPath);
    process.exit(0);
  }
  const files = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const file of files) {
    fs.rmSync(file, { force: true });
    console.log("Removed", file);
    const dir = path.dirname(file);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      console.log("Pruned empty", dir);
    }
  }
  fs.rmSync(manifestPath, { force: true });
  process.exit(0);
}

const shortId = () => crypto.randomUUID().slice(0, 8);
const b64ish = (n) =>
  crypto.randomBytes(n).toString("base64url").replace(/[-_]/g, "A");
const encodeCwd = (cwd) =>
  `--${cwd.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\//g, "-")}--`;

/** Fernet-style blob like the real openai-codex encrypted_content payloads. */
const encryptedReasoning = (summary) =>
  JSON.stringify({
    id: `rs_${crypto.randomBytes(25).toString("hex")}`,
    type: "reasoning",
    content: [],
    encrypted_content: `gAAAAAB${b64ish(560)}`,
    summary: [{ type: "summary_text", text: summary }],
  });

/** Opaque base64 signature like anthropic's signature_delta output. */
const anthropicSignature = () => `EqQBCkYIChgCIkD${b64ish(150)}`;

const usage = (input, output, reasoning = 0, cacheRead = 0) => {
  const cost = {
    input: +(input * 0.000002).toFixed(6),
    output: +(output * 0.00001).toFixed(6),
    cacheRead: +(cacheRead * 0.0000002).toFixed(6),
    cacheWrite: 0,
    total: 0,
  };
  cost.total = +(cost.input + cost.output + cost.cacheRead).toFixed(6);
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    ...(reasoning ? { reasoning } : {}),
    totalTokens: input + output + cacheRead + reasoning,
    cost,
  };
};

// 1x1 transparent PNG.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * Builds one session: walks `steps`, chaining ids, advancing a clock, and
 * writes <stamp>_<uuid>.jsonl under the encoded cwd dir.
 */
function writeSession({ cwd, start, steps }) {
  const sessionId = crypto.randomUUID();
  const clock = new Date(start);
  const tick = (seconds) => {
    clock.setSeconds(clock.getSeconds() + seconds);
    return clock.toISOString();
  };

  const lines = [
    {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: clock.toISOString(),
      cwd,
    },
  ];
  let leafId = null;
  const ids = {};

  for (const step of steps) {
    const ts = tick(step.after ?? 8);
    const id = shortId();
    if (step.ref) ids[step.ref] = id;
    const parentId =
      step.parent !== undefined ? (ids[step.parent] ?? null) : leafId;
    const { after, ref, parent, make, ...rest } = step;
    const entry = make
      ? make({ id, parentId, timestamp: ts, ids })
      : { ...rest, id, parentId, timestamp: ts };
    if (step.dropTimestamp) delete entry.timestamp;
    delete entry.dropTimestamp;
    lines.push(entry);
    leafId = id;
  }

  const dir = path.join(root, encodeCwd(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(start).toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}_${sessionId}.jsonl`);
  fs.writeFileSync(
    file,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    "utf8",
  );
  return file;
}

const msg = (message) => ({ type: "message", message });
const user = (content, at) =>
  msg({ role: "user", content, timestamp: at ?? Date.now() });
const toolResult = (toolCallId, toolName, text, isError = false) =>
  msg({
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: Date.now(),
  });
const named = (name) => ({ type: "session_info", name });

/** Assistant helpers per provider, matching pi-ai's real mappings. */
const codex = (model, parts, extra = {}) =>
  msg({
    role: "assistant",
    content: parts,
    api: "openai-codex-responses",
    provider: "openai-codex",
    model,
    usage: usage(1200 + Math.floor(Math.random() * 800), 300, 40),
    stopReason: "toolUse",
    timestamp: Date.now(),
    responseId: `resp_${crypto.randomBytes(24).toString("hex")}`,
    rawStopReason: "completed",
    ...extra,
  });
const codexThinking = (summary) => ({
  type: "thinking",
  thinking: `**${summary}**`,
  thinkingSignature: encryptedReasoning(`**${summary}**`),
});

const kimi = (parts, extra = {}) =>
  msg({
    role: "assistant",
    content: parts,
    api: "openai-completions",
    provider: "moonshotai",
    model: "kimi-k2-thinking",
    usage: usage(900, 640, 380),
    stopReason: "stop",
    timestamp: Date.now(),
    rawStopReason: "stop",
    ...extra,
  });
const kimiThinking = (text) => ({
  type: "thinking",
  thinking: text,
  thinkingSignature: "reasoning_content",
});

const claude = (model, parts, extra = {}) =>
  msg({
    role: "assistant",
    content: parts,
    api: "anthropic-messages",
    provider: "anthropic",
    model,
    usage: usage(2100, 520, 0, 1800),
    stopReason: "toolUse",
    timestamp: Date.now(),
    rawStopReason: "tool_use",
    ...extra,
  });
const claudeThinking = (text) => ({
  type: "thinking",
  thinking: text,
  thinkingSignature: anthropicSignature(),
});

const gemini = (model, parts, extra = {}) =>
  msg({
    role: "assistant",
    content: parts,
    api: "google-generative-ai",
    provider: "google",
    model,
    usage: usage(700, 260, 120),
    stopReason: "stop",
    timestamp: Date.now(),
    rawStopReason: "STOP",
    ...extra,
  });

const toolCall = (idPrefix, name, args) => ({
  type: "toolCall",
  id: `${idPrefix}${crypto.randomBytes(12).toString("hex")}`,
  name,
  arguments: args,
});

const day = (offset, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  d.setHours(h, m, Math.floor(Math.random() * 50), 123);
  return d;
};

const V2 = "/home/pc/pi-session-browser/v2";
const sessions = [];

/* ── openai-codex: encrypted reasoning, tools, final text ─────────────── */
sessions.push(
  writeSession({
    cwd: V2,
    start: day(0, 9, 15),
    steps: [
      { type: "thinking_level_change", thinkingLevel: "medium" },
      { type: "model_change", provider: "openai-codex", modelId: "gpt-5.6-terra" },
      user([{ type: "text", text: "The SSE stream dies when I delete a session file while the chat modal is open. Find out why and fix it." }]),
      {
        ...codex("gpt-5.6-terra", [
          codexThinking("Scanning the stream route for watcher lifecycle bugs"),
          toolCall("call_", "read", { path: "src/app/api/stream/route.ts" }),
          toolCall("call_", "bash", { command: "grep -rn 'fs.watch' src/" }),
        ]),
        ref: "a1",
      },
      toolResult("call_abc123", "read", "import { watch, promises as fs } from \"node:fs\";\n// ...route source elided for fixture...\nwatcher = watch(safePath, (eventType) => {\n  if (eventType === 'change') { /* ... */ }\n});"),
      toolResult("call_def456", "bash", "src/app/api/stream/route.ts:36:      watcher = watch(safePath, (eventType) => {"),
      codex("gpt-5.6-terra", [
        codexThinking("Confirming rename events kill the watcher on Linux"),
        { type: "text", text: "Found it. On Linux, deleting the watched file emits a `rename` event, after which the watcher is dead — the route only ever handled `change`, so the client keeps a stream that will never update again.\n\nThe fix is to handle `rename`: stat the path, re-arm the watcher if the file still exists (atomic replaces from message edits look identical), and end the stream with a `gone` event if it doesn't." },
      ], { stopReason: "stop", rawStopReason: "completed" }),
      named("Fix SSE watcher death on delete"),
    ],
  }),
);

/* ── kimi-k2-thinking via moonshotai: fully visible reasoning ─────────── */
sessions.push(
  writeSession({
    cwd: V2,
    start: day(0, 14, 40),
    steps: [
      { type: "model_change", provider: "moonshotai", modelId: "kimi-k2-thinking" },
      user([{ type: "text", text: "Pagination keeps showing \"Page 3 of 1\" when I switch folders. Can you fix the reset logic?" }]),
      kimi([
        kimiThinking(
          "The user reports a pagination bug: the page state survives a dataset change. Let me reason about where page state lives.\n\nIn DateTimeline.tsx there is `const [page, setPage] = useState(1)` and the fetch effect depends on location/fromDate/toDate — but nothing resets `page` when those change. So switching from a folder with 3 pages to one with 1 page leaves page=3, and the slice `(page-1)*pageSize` starts past the end of the array, rendering an empty grid while the footer says \"Page 3 of 1\".\n\nTwo idiomatic fixes:\n1. An effect that calls setPage(1) on filter change — works but is a cascading render.\n2. The React-blessed \"adjust state during render\" pattern: keep the previous filter key in state, compare during render, and reset both page and data when it differs.\n\nOption 2 avoids the extra render pass and satisfies the new react-hooks lint rules, so I'll go with that.",
        ),
        { type: "text", text: "The page state never resets when the dataset changes. I'll use the render-time reset pattern: track the previous `location|fromDate|toDate` key in state, and when it differs from the current one, set it back and reset `page` to 1 before the stale slice can render." },
        toolCall("call_", "edit", { path: "src/components/DateTimeline.tsx", operation: "apply-reset-pattern" }),
      ], { stopReason: "toolUse", rawStopReason: "tool_calls" }),
      toolResult("call_kimifix1", "edit", "Applied 1 edit to src/components/DateTimeline.tsx"),
      kimi([
        kimiThinking("Edit applied cleanly. Summarize the change and note the test to add."),
        { type: "text", text: "Done — switching folders or date ranges now lands on page 1 with a fresh dataset. Worth adding a test that flips the location twice and asserts the rendered page indicator." },
      ]),
      named("Pagination reset (kimi thinking demo)"),
    ],
  }),
);

/* ── anthropic: visible thinking + signature, cache-heavy usage ───────── */
sessions.push(
  writeSession({
    cwd: "/home/pc/Documents",
    start: day(1, 11, 5),
    steps: [
      user([{ type: "text", text: "Sort ~/Documents/receipts into per-year folders and give me a total per year." }]),
      {
        ...claude("claude-opus-4-6", [
          claudeThinking(
            "I need to see what's actually in the receipts folder before moving anything. Filenames may or may not carry dates; if they don't, mtime is a reasonable fallback but I should tell the user which files used it. I'll start with a non-destructive listing.",
          ),
          toolCall("toolu_01", "bash", { command: "ls -la ~/Documents/receipts | head -50" }),
        ]),
        ref: "c1",
      },
      toolResult("toolu_01aaaa", "bash", "total 1240\n-rw-r--r-- 1 pc pc  84211 Jan 14  2025 receipt-2025-01-14-hetzner.pdf\n-rw-r--r-- 1 pc pc  10233 Mar 02  2025 receipt-2025-03-02-jetbrains.pdf\n-rw-r--r-- 1 pc pc 220145 Jul 29  2026 receipt-2026-07-29-framework.pdf\n-rw-r--r-- 1 pc pc  33900 Aug 02  2026 scan0042.pdf"),
      claude("claude-opus-4-6", [
        claudeThinking("Three files have ISO dates in their names; scan0042.pdf doesn't, so its year must come from mtime (2026). I'll propose the moves before executing."),
        { type: "text", text: "Here's the plan:\n\n- `2025/` ← receipt-2025-01-14-hetzner.pdf, receipt-2025-03-02-jetbrains.pdf\n- `2026/` ← receipt-2026-07-29-framework.pdf, scan0042.pdf *(year from file mtime — no date in the name)*\n\nSay the word and I'll move them and total each year." },
      ], { stopReason: "stop", rawStopReason: "end_turn" }),
      named("Receipts by year"),
    ],
  }),
);

/* ── error stop: empty content + errorMessage (rate limit) ────────────── */
sessions.push(
  writeSession({
    cwd: "/home/pc/Documents",
    start: day(1, 18, 30),
    steps: [
      user([{ type: "text", text: "Summarize the notes in meeting-notes.md" }]),
      claude("claude-haiku-4-5", [], {
        stopReason: "error",
        errorMessage:
          "429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\",\"message\":\"Number of requests has exceeded your per-minute rate limit\"}}",
        usage: usage(450, 0),
        rawStopReason: undefined,
      }),
      user([{ type: "text", text: "try again" }]),
      claude("claude-haiku-4-5", [
        { type: "text", text: "Three decisions from the notes: ship the beta Friday, move standup to 9:30, and drop the legacy exporter after v2.1." },
      ], { stopReason: "stop", rawStopReason: "end_turn" }),
    ],
  }),
);

/* ── gemini: visible thinking + image content in the user turn ────────── */
sessions.push(
  writeSession({
    cwd: "/home/pc/Downloads",
    start: day(3, 16, 20),
    steps: [
      { type: "model_change", provider: "google", modelId: "gemini-2.5-pro" },
      user([
        { type: "text", text: "What's in this screenshot? The download finished but the installer complains." },
        { type: "image", data: TINY_PNG, mimeType: "image/png" },
      ]),
      gemini("gemini-2.5-pro", [
        { type: "thinking", thinking: "The screenshot shows a checksum mismatch dialog. The likely cause is a partial download — the file size in the dialog is smaller than the published size. I should have the user re-verify the sha256 before re-downloading." },
        { type: "text", text: "That dialog is a checksum mismatch — the downloaded file is truncated. Run `sha256sum` on the file and compare it against the published hash; if it differs, re-download with `wget -c` to resume rather than starting over." },
      ]),
    ],
  }),
);

/* ── long codex session: scrolling, many collapsed tool results ───────── */
{
  const steps = [
    { type: "thinking_level_change", thinkingLevel: "high" },
    user([{ type: "text", text: "Triage everything in ~/Downloads: what's safe to delete, what's worth keeping?" }]),
  ];
  for (let i = 0; i < 12; i++) {
    steps.push({
      ...codex("gpt-5.5", [
        codexThinking(`Batch ${i + 1}: inspecting the next slice of files`),
        toolCall("call_", "bash", { command: `ls -la ~/Downloads | sed -n '${i * 8 + 1},${i * 8 + 8}p'` }),
      ]),
      after: 20,
    });
    steps.push(
      toolResult(
        `call_batch${i}`,
        "bash",
        Array.from({ length: 8 }, (_, j) => `-rw-r--r-- 1 pc pc ${(Math.random() * 9e7 | 0).toString().padStart(8)} Aug 0${(j % 7) + 1} 2026 file-${i * 8 + j}.${["zip", "iso", "pdf", "deb", "tar.gz"][j % 5]}`).join("\n"),
      ),
    );
  }
  steps.push(
    codex("gpt-5.5", [
      codexThinking("Compiling the keep/delete verdict"),
      { type: "text", text: "Verdict: 4.2 GB reclaimable.\n\n**Safe to delete** — 9 installer `.deb`s already installed, 3 duplicate ISOs, every `.zip` you've already extracted (checksums match the extracted trees).\n\n**Keep** — the two tax PDFs (move them to ~/Documents/receipts?), and `backup-2026-07.tar.gz`, which is the only copy on this machine." },
    ], { stopReason: "stop", rawStopReason: "completed" }),
    named("Downloads triage"),
  );
  sessions.push(writeSession({ cwd: "/home/pc/Downloads", start: day(3, 9, 0), steps }));
}

/* ── compaction mid-session (anthropic) ───────────────────────────────── */
sessions.push(
  writeSession({
    cwd: "/home/pc",
    start: day(7, 12, 10),
    steps: [
      user([{ type: "text", text: "Bluetooth won't turn on after suspend. Investigate." }]),
      {
        ...claude("claude-opus-4-5", [
          claudeThinking("Classic btusb suspend regression profile. Check rfkill, dmesg, and the usb enumeration first."),
          toolCall("toolu_01", "bash", { command: "rfkill list; dmesg | grep -i blue | tail -20" }),
        ]),
        ref: "k1",
      },
      { ...toolResult("toolu_01comp", "bash", "0: hci0: Bluetooth\n\tSoft blocked: no\n\tHard blocked: no\n[41211.3] Bluetooth: hci0: command 0x0c03 tx timeout\n[41211.3] Bluetooth: hci0: Reset failed"), ref: "k2" },
      {
        make: ({ id, parentId, timestamp, ids }) => ({
          type: "compaction",
          id,
          parentId,
          timestamp,
          summary:
            "Diagnosed a btusb suspend regression: hci0 times out on reset after resume (command 0x0c03 tx timeout). Ruled out rfkill and service state; narrowed to the USB radio needing a re-enumeration. Next step was unbinding/rebinding the btusb module.",
          firstKeptEntryId: ids.k2,
          tokensBefore: 48211,
        }),
      },
      user([{ type: "text", text: "ok so what's the permanent fix?" }]),
      claude("claude-opus-4-5", [
        claudeThinking("Post-compaction context is thin by design; the summary carries the diagnosis. A systemd sleep hook that rebinds btusb on resume is the standard durable fix."),
        { type: "text", text: "A systemd sleep hook. Drop this in `/usr/lib/systemd/system-sleep/btusb-rebind.sh` (mode 0755):\n\n```bash\n#!/bin/sh\n[ \"$1\" = post ] && { modprobe -r btusb; modprobe btusb; }\n```\n\nIt reloads the radio driver on every resume, which is exactly the manual recovery that worked." },
      ], { stopReason: "stop", rawStopReason: "end_turn" }),
      named("Bluetooth after suspend"),
    ],
  }),
);

/* ── branched tree + branch_summary ───────────────────────────────────── */
sessions.push(
  writeSession({
    cwd: "/home/pc",
    start: day(7, 17, 45),
    steps: [
      { ...user([{ type: "text", text: "My shell startup is slow. Profile it." }]), ref: "root" },
      {
        ...codex("gpt-5.4", [
          codexThinking("Timing each rc-file section"),
          { type: "text", text: "nvm's init is 78% of your 1.4s startup. Two options: lazy-load nvm, or switch to fnm." },
        ], { stopReason: "stop", rawStopReason: "completed" }),
        ref: "answer",
      },
      { ...user([{ type: "text", text: "let's try replacing it with fnm" }]), parent: "answer", ref: "branchA" },
      { ...codex("gpt-5.4", [{ type: "text", text: "fnm installed and .bashrc updated — startup is now 210ms. Your installed node versions were migrated." }], { stopReason: "stop", rawStopReason: "completed" }), ref: "branchATip" },
      {
        parent: "answer",
        make: ({ id, parentId, timestamp, ids }) => ({
          type: "branch_summary",
          id,
          parentId,
          timestamp,
          fromId: ids.branchATip,
          summary: "Explored replacing nvm with fnm: install worked, startup dropped to 210ms, but the user wanted to keep nvm-managed .nvmrc auto-switching, so this branch was abandoned.",
        }),
      },
      { ...user([{ type: "text", text: "actually keep nvm but lazy-load it" }]) },
      codex("gpt-5.4", [{ type: "text", text: "Done — nvm now loads on first use of `node`/`npm`/`nvm`. Cold prompt is 180ms, and `.nvmrc` switching still works once loaded." }], { stopReason: "stop", rawStopReason: "completed" }),
      named("Slow shell startup"),
    ],
  }),
);

/* ── edge cases: custom roles, bashExecution, string content, no ts ───── */
sessions.push(
  writeSession({
    cwd: "/home/pc",
    start: day(5, 8, 25),
    steps: [
      msg({ role: "custom", customType: "memory", content: "Loaded 3 memories for /home/pc", display: true, timestamp: Date.now() }),
      msg({ role: "custom", customType: "telemetry", content: "internal bookkeeping — should never render", display: false, timestamp: Date.now() }),
      user("Plain string content instead of a parts array — still valid per the format docs."),
      kimi([
        kimiThinking("String-content user messages are the v1-era shape; answer normally."),
        { type: "text", text: "Got it — string content parses the same as a single text part." },
      ]),
      msg({ role: "bashExecution", command: "htop", output: "(interactive session, output not captured)", exitCode: 0, cancelled: false, truncated: false, timestamp: Date.now() }),
      {
        dropTimestamp: true,
        make: ({ id, parentId }) => ({
          type: "compaction",
          id,
          parentId,
          summary: "An untimestamped compaction entry — the UI should omit the time row rather than showing Invalid Date.",
          tokensBefore: 12000,
        }),
      },
      user([{ type: "text", text: "and an image on its own:" }, { type: "image", data: TINY_PNG, mimeType: "image/png" }]),
      kimi([{ type: "text", text: "Rendered as [image] in the transcript — as expected." }]),
      named("[edge cases] roles & content shapes"),
    ],
  }),
);

/* ── kimi-coding (k3 via anthropic-messages) on the Desktop ───────────── */
sessions.push(
  writeSession({
    cwd: "/home/pc/Desktop",
    start: day(30, 15, 0),
    steps: [
      { type: "model_change", provider: "kimi-coding", modelId: "k3" },
      user([{ type: "text", text: "Write a script that renames my screenshots to their EXIF date." }]),
      msg({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Screenshots rarely carry EXIF, so fall back to mtime. exiftool handles both in one pass with -FileModifyDate fallback. Keep it idempotent.", thinkingSignature: anthropicSignature() },
          { type: "text", text: "```bash\n#!/usr/bin/env bash\nexiftool '-FileName<${DateTimeOriginal;DateFmt(\"%Y-%m-%d_%H%M%S\")}.%e' \\\n  -d %Y-%m-%d_%H%M%S -ext png -ext jpg .\n```\nFiles without EXIF keep their names; run with `-FileModifyDate` as the source if you want mtime fallback." },
        ],
        api: "anthropic-messages",
        provider: "kimi-coding",
        model: "k3",
        usage: usage(600, 340, 0),
        stopReason: "stop",
        timestamp: Date.now(),
        rawStopReason: "end_turn",
      }),
      named("Screenshot renamer"),
    ],
  }),
);

/* ── renamed twice, and a cleared name ────────────────────────────────── */
sessions.push(
  writeSession({
    cwd: "/home/pc/Desktop",
    start: day(30, 16, 30),
    steps: [
      user([{ type: "text", text: "quick: convert all my .heic photos on the Desktop to jpg" }]),
      gemini("gemini-2.5-flash", [{ type: "text", text: "`for f in *.heic; do heif-convert \"$f\" \"${f%.heic}.jpg\"; done` — 14 files converted." }]),
      named("first name (should not show)"),
      named("HEIC → JPG (latest name wins)"),
    ],
  }),
);
sessions.push(
  writeSession({
    cwd: "/home/pc/Pictures",
    start: day(14, 13, 15),
    steps: [
      user("dedupe my Pictures folder"),
      gemini("gemini-2.5-flash", [{ type: "text", text: "Found 212 duplicates by content hash (18 GB). They're listed in ~/Pictures/duplicates.txt — review it and I'll delete on your go-ahead." }]),
      named("was named, then cleared"),
      named(""),
    ],
  }),
);

/* ── untouched session: header only, must stay invisible ──────────────── */
sessions.push(
  writeSession({ cwd: "/home/pc/Pictures", start: day(14, 13, 40), steps: [] }),
);

fs.writeFileSync(manifestPath, JSON.stringify(sessions, null, 2));
console.log(`Wrote ${sessions.length} sessions under ${root}`);
for (const s of sessions) console.log(" ", s);
console.log(`\nManifest: ${manifestPath}`);
console.log("Clean up with: node generate_test_sessions.mjs --clean");
