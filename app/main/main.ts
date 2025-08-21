import { app, BrowserWindow, globalShortcut } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';

let win: BrowserWindow | null = null;
let backend: ReturnType<typeof spawn> | null = null;

function startBackend() {
  backend = spawn(process.execPath, ['--experimental-modules', path.join(process.cwd(), 'backend/server.ts')], {
    env: { ...process.env },
    stdio: 'inherit'
  });
  backend.on('exit', (code) => console.log('[backend exited]', code));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await win.loadFile(path.join(process.cwd(), 'app/renderer/index.html'));
  win.setAlwaysOnTop(true, 'floating');
}

app.whenReady().then(async () => {
  startBackend();
  await createWindow();

  let clickThrough = false;
  globalShortcut.register('CommandOrControl+M', () => {
    clickThrough = !clickThrough;
    win?.setIgnoreMouseEvents(clickThrough, { forward: true });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    backend?.kill();
  } catch (e) {
    // no-op
  }
});
