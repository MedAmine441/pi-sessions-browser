const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn, fork } = require('child_process');
const net = require('net');

let mainWindow;
let nextProcess;

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

function waitForServer(port) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
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

async function createWindow() {
  const port = await findOpenPort();

  if (app.isPackaged) {
    const serverPath = path.join(process.resourcesPath, '.next/standalone/server.js');
    nextProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: port,
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        NODE_PATH: path.join(process.resourcesPath, '.next/standalone/standalone_node_modules')
      }
    });
  } else {
    // Development mode
    nextProcess = spawn('npm', ['run', 'dev', '--', '-p', port], {
      shell: true,
      env: {
        ...process.env,
      }
    });
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
  });

  // Hide window until server is ready and loaded
  mainWindow.hide();

  await waitForServer(port);
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.show();
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
  if (nextProcess) {
    nextProcess.kill();
  }
});
