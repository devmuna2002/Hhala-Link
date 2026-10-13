const { contextBridge } = require('electron');

// Minimal, safe bridge so the UI can detect the desktop shell.
contextBridge.exposeInMainWorld('hlalaDesktop', {
  platform: process.platform,
  isDesktop: true,
});
