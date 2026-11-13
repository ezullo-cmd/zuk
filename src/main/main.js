const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('electron-log');
const config = require('./config');
const db = require('./db');
const persone = require('./persone');
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

  handle('persone:list', (clienteId) => persone.listPersone(clienteId));
  handle('persone:get', (clienteId, id) => persone.dettaglioPersona(clienteId, id));
  handle('persone:save', (clienteId, id, data) => persone.salvaPersona(clienteId, id, data));
  handle('percorsi:save', (clienteId, id, data) => persone.salvaPercorso(clienteId, id, data));
  handle('pagamenti:save', (clienteId, data, file) => persone.salvaPagamento(clienteId, data, file));
  handle('documenti:upload', (clienteId, personaId, file, descr) => persone.caricaDocumento(clienteId, personaId, file, descr));
  handle('documenti:delete', (clienteId, id) => persone.eliminaDocumento(clienteId, id));
  handle('documenti:open', async (clienteId, id) => {
    const doc = await persone.leggiDocumento(clienteId, id);
    const dir = path.join(os.tmpdir(), 'zuk-documenti');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${clienteId}-${id}-${doc.nome_file.replace(/[^\w.\- ]+/g, '_')}`);
    fs.writeFileSync(file, doc.dati);
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return true;
  });
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
