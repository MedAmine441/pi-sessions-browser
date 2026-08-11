/**
 * Dev tool: seeds a batch of fake sessions to exercise the browser. Honors
 * PI_SESSION_DIR so it can't pollute real data by accident:
 *
 *   PI_SESSION_DIR=/tmp/fake-sessions node create_fake_sessions.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const cwd = '/home/pc';
const root =
  process.env.PI_SESSION_DIR || path.join(os.homedir(), '.pi/agent/sessions');
const sessionDir = path.join(root, `--${cwd.replace(/^\/+/, '').replace(/\//g, '-')}--`);
fs.mkdirSync(sessionDir, { recursive: true });

const d = new Date('2026-06-27T12:00:00Z');
const ts = d.toISOString();

const shortId = () => crypto.randomUUID().slice(0, 8);

for (let i = 0; i < 30; i++) {
  const id = crypto.randomUUID();
  const filename = `${ts.replace(/[:.]/g, "-")}_${id}.jsonl`;
  const filepath = path.join(sessionDir, filename);

  // Matches Pi's real on-disk format: a session header, then short-id entries
  // chained by parentId, with names carried by session_info entries.
  const header = { type: "session", version: 3, id, timestamp: ts, cwd };
  const msg1 = {
    type: "message",
    id: shortId(),
    parentId: null,
    timestamp: ts,
    message: { role: "user", content: [{ type: "text", text: `Test Prompt ${i+1} on June 27` }] }
  };
  const msg2 = {
    type: "message",
    id: shortId(),
    parentId: msg1.id,
    timestamp: ts,
    message: { role: "assistant", content: [{ type: "text", text: "Hello! This is a generated test session for June 27." }] }
  };
  const name = {
    type: "session_info",
    id: shortId(),
    parentId: msg2.id,
    timestamp: ts,
    name: `Bulk Test Session ${i+1}`,
  };

  const content = [header, msg1, msg2, name].map(obj => JSON.stringify(obj)).join('\n') + '\n';
  fs.writeFileSync(filepath, content, 'utf-8');
  console.log('Created', filepath);
}
