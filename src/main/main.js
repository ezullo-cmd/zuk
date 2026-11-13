const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');
const config = require('./config');
const db = require('./db');
const { setupUpdater } = require('./updater');

log.initialize();
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Zuk Gestionale',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Ogni handler restituisce { ok, data } o { ok:false, error } per gestire gli errori nel renderer
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      log.error(channel, err);
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), dbReady: db.isReady() }));

  handle('settings:get', () => config.load());
  handle('settings:test', (dbCfg) => db.testConnection(dbCfg));
  handle('settings:save', async (dbCfg) => {
    const cfg = config.load();
    cfg.db = { ...cfg.db, ...dbCfg };
    await db.init(cfg.db); // se fallisce non salviamo
    config.save(cfg);
    return true;
  });

  handle('dashboard', () => db.dashboard());
  handle('clienti:list', (opts) => db.listClienti(opts));
  handle('clienti:get', (id) => db.getCliente(id));
  handle('clienti:create', (data) => db.createCliente(data));
  handle('clienti:update', (id, data) => db.updateCliente(id, data));
  handle('clienti:archive', (id, archiviato) => db.setArchiviato(id, archiviato));

  handle('records:list', (clienteId, table) => db.list(clienteId, table));
  handle('records:create', (clienteId, table, data) => db.create(clienteId, table, data));
  handle('records:update', (clienteId, table, id, data) => db.update(clienteId, table, id, data));
  handle('records:delete', (clienteId, table, id) => db.remove(clienteId, table, id));
}

app.whenReady().then(async () => {
  registerIpc();
  try {
    await db.init(config.load().db);
  } catch (err) {
    log.warn('Connessione DB non riuscita all\'avvio:', err.message);
  }
  createWindow();
  setupUpdater(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { db.close(); });
