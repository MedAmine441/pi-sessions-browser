const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn, fork } = require('child_process');
const net = require('net');

let mainWindow;
let nextProcess;
let serverReady = false;
let shuttingDown = false;

function findOpenPort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const interval = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(interval);
        reject(new Error('The app server did not come up in time.'));
        return;
      }
      const socket = new net.Socket();
      socket.connect(port, '127.0.0.1', () => {
        socket.destroy();
        clearInterval(interval);
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
      });
    }, 500);
  });
}

/** A dead or unstartable server means a dead app — say so and leave. */
function fail(message) {
  if (shuttingDown) return;
  shuttingDown = true;
  dialog.showErrorBox('Pi Session Browser', message);
  app.quit();
}

function startServer(port) {
  if (app.isPackaged) {
    const serverPath = path.join(process.resourcesPath, '.next/standalone/server.js');
    nextProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: port,
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        // electron-builder mangles node_modules inside extraResources, so
        // build:standalone ships the standalone tree's modules under another
        // name and NODE_PATH points resolution back at them.
        NODE_PATH: path.join(process.resourcesPath, '.next/standalone/standalone_node_modules'),
      },
      // will-quit never runs if Electron crashes; the watchdog makes the
      // server follow its parent down instead of lingering on the port.
      execArgv: ['--require', path.join(process.resourcesPath, 'server-watchdog.js')],
    });
  } else {
    // No shell indirection: killing a shell leaves the `next dev` tree under
    // it running. npm runs directly, in its own process group that
    // stopServer() can kill as a whole.
    nextProcess = spawn('npm', ['run', 'dev', '--', '-p', String(port)], {
      detached: true,
      stdio: 'inherit',
      env: { ...process.env },
    });
  }

  nextProcess.on('error', (error) => {
    fail(`The app server failed to start: ${error.message}`);
  });
  nextProcess.on('exit', (code, signal) => {
    nextProcess = null;
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `code ${code}`;
    fail(
      serverReady
        ? `The app server stopped unexpectedly (${detail}).`
        : `The app server exited before it was ready (${detail}).`,
    );
  });
}

function stopServer() {
  if (!nextProcess) return;
  if (app.isPackaged) {
    nextProcess.kill();
  } else {
    // The whole dev process group: npm and the next dev server under it.
    try {
      process.kill(-nextProcess.pid, 'SIGTERM');
    } catch {
      nextProcess.kill();
    }
  }
}

async function createWindow() {
  const port = await findOpenPort();

  startServer(port);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // No preload exists, so the renderer can be fully sandboxed.
      sandbox: true,
    },
  });

  // The window shows exactly one local origin; anything else is denied.
  const appOrigin = `http://127.0.0.1:${port}`;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== appOrigin && !url.startsWith(`${appOrigin}/`)) {
      event.preventDefault();
    }
  });

  // Hide window until server is ready and loaded
  mainWindow.hide();

  try {
    await waitForServer(port);
    serverReady = true;
    await mainWindow.loadURL(`${appOrigin}`);
    mainWindow.show();
  } catch (error) {
    fail(error.message);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  shuttingDown = true;
  stopServer();
});
