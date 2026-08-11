/**
 * Loaded (via --require) into the standalone Next server forked by main.js.
 * Electron's will-quit handler kills the server on a normal exit, but never
 * runs on a crash — this makes the server notice its parent is gone and
 * follow it down instead of lingering on the port forever.
 */
const parent = process.ppid;
setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    process.exit(0);
  }
}, 5000).unref();
