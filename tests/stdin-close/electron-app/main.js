const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');

  // Log when window is ready
  win.webContents.on('did-finish-load', () => {
    console.log('[TEST-ELECTRON-APP] Window loaded successfully');
  });
}

app.whenReady().then(() => {
  console.log('[TEST-ELECTRON-APP] App is ready, creating window...');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  console.log('[TEST-ELECTRON-APP] All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  console.log('[TEST-ELECTRON-APP] App quit');
});

console.log('[TEST-ELECTRON-APP] Main process started, PID:', process.pid);
