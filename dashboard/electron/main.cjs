const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_URL || 'http://localhost:5174';

if (process.platform === 'win32') app.setAppUserModelId('com.hlalalink.studio');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#f4f4f6',
    autoHideMenuBar: true,
    title: 'Hlala Link Studio',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The packaged app loads over file://, whose opaque origin gets
      // rejected by the API's CORS whitelist. The window only ever talks
      // to our own first-party API, so same-origin policy is lifted here.
      webSecurity: false,
    },
  });

  if (isDev) {
    win.loadURL(DEV_URL).catch(() => {
      win.loadFile(path.join(__dirname, '../dist/index.html'));
    });
    if (process.env.HLALA_DEBUG) win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links (docs, WhatsApp, images) in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('file://')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
