const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const sessionDir = path.join(os.homedir(), '.pi/agent/sessions/--home-pc--');
fs.mkdirSync(sessionDir, { recursive: true });

const d = new Date('2026-06-27T12:00:00Z');
const ts = d.toISOString();

for (let i = 0; i < 30; i++) {
  const id = crypto.randomUUID();
  const filename = `${ts.replace(/[:.]/g, "-")}_${id}.jsonl`;
  const filepath = path.join(sessionDir, filename);
  
  const header = { type: "session", version: 3, id, timestamp: ts, cwd: "/home/pc" };
  const name = { type: "name", id: crypto.randomUUID(), name: `Bulk Test Session ${i+1}`, timestamp: ts };
  const msg1 = {
    type: "message",
    id: crypto.randomUUID(),
    parentId: "root",
    timestamp: ts,
    message: { role: "user", content: [{ type: "text", text: `Test Prompt ${i+1} on June 27` }] }
  };
  const msg2 = {
    type: "message",
    id: crypto.randomUUID(),
    parentId: msg1.id,
    timestamp: ts,
    message: { role: "assistant", content: [{ type: "text", text: "Hello! This is a generated test session for June 27." }] }
  };
  
  const content = [header, name, msg1, msg2].map(obj => JSON.stringify(obj)).join('\n') + '\n';
  fs.writeFileSync(filepath, content, 'utf-8');
  console.log('Created', filename);
}
