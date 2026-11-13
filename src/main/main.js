const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('electron-log');
const config = require('./config');
const db = require('./db');
const persone = require('./persone');
const promemoria = require('./promemoria');
const whatsapp = require('./whatsapp');
const portale = require('./portale');

// i permessi dell'utente del portale vanno riapplicati quando cambiano tabelle o clienti
const aggiornaPermessiPortale = () => portale.applicaPermessi().catch((e) => log.warn('Permessi portale:', e.message));

promemoria.configura({
  emailConfig: () => config.emailConfig(),
  whatsapp,
  orario: () => config.load().orarioPromemoria
});
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
    aggiornaPermessiPortale();
    config.save(cfg);
    return true;
  });

  handle('dashboard', () => db.dashboard());
  handle('clienti:list', (opts) => db.listClienti(opts));
  handle('clienti:get', (id) => db.getCliente(id));
  handle('clienti:create', async (data) => {
    const c = await db.createCliente(data);
    aggiornaPermessiPortale();
    return c;
  });

  // Portale web in sola lettura
  ipcMain.handle('app:apriLink', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(url);
  });
  handle('portale:get', () => ({ url: config.load().portaleUrl || '' }));
  handle('portale:saveUrl', (url) => {
    const c = config.load();
    c.portaleUrl = String(url || '').trim().replace(/\/+$/, '');
    config.save(c);
    return true;
  });
  handle('portale:accessoDb', () => portale.creaAccessoDb());
  handle('portale:accessi', (utente) => portale.ultimiAccessi(utente));
  handle('portale:verifica', (clienteId, utente, password) => portale.verificaAccesso(clienteId, utente, password));
  handle('portale:sblocca', (utente) => portale.sblocca(utente));
  handle('clienti:update', (id, data) => db.updateCliente(id, data));
  handle('clienti:archive', (id, archiviato) => db.setArchiviato(id, archiviato));

  handle('records:list', (clienteId, table) => db.list(clienteId, table));
  handle('records:create', (clienteId, table, data) => db.create(clienteId, table, data));
  handle('records:update', (clienteId, table, id, data) => db.update(clienteId, table, id, data));
  handle('records:delete', (clienteId, table, id) => db.remove(clienteId, table, id));

  handle('persone:list', (clienteId) => persone.listPersone(clienteId));
  handle('promemoria:default', () => ({ testo: promemoria.TESTO_DEFAULT, oggetto: promemoria.OGGETTO_DEFAULT }));
  handle('promemoria:list', (clienteId) => promemoria.elenco(clienteId));
  handle('promemoria:daInviare', () => promemoria.daInviareTutti());
  handle('promemoria:check', () => controllaPromemoria());
  handle('promemoria:inviato', (clienteId, id) => promemoria.segnaInviato(clienteId, id));
  handle('promemoria:rimetti', async (clienteId, id) => {
    await promemoria.rimettiInCoda(clienteId, id);
    return controllaPromemoria();
  });

  // Casella email unica per i promemoria (la password non torna mai all'interfaccia)
  handle('email:get', () => {
    const c = config.load();
    const { passwordCifrata, ...e } = c.email;
    return { ...e, haPassword: !!passwordCifrata, orario: c.orarioPromemoria };
  });
  handle('email:save', (data) => {
    const c = config.load();
    c.email = {
      ...c.email,
      user: String(data.user || '').trim(),
      host: data.host || 'smtp.gmail.com',
      port: Number(data.port) || 465,
      secure: data.secure !== false
    };
    if (data.password) c.email.passwordCifrata = config.cifra(data.password.replace(/\s+/g, ''));
    if (/^\d{2}:\d{2}$/.test(data.orario || '')) c.orarioPromemoria = data.orario;
    config.save(c);
    return true;
  });
  handle('email:prova', (data) => {
    const salvata = config.emailConfig();
    const cfg = {
      ...salvata, ...data,
      password: data.password ? data.password.replace(/\s+/g, '') : salvata.password
    };
    return promemoria.emailDiProva(cfg, cfg.user);
  });

  // WhatsApp Web
  handle('wa:stato', () => whatsapp.getStato());
  handle('wa:connetti', () => whatsapp.connetti());
  handle('wa:annulla', () => whatsapp.annulla());
  handle('wa:disconnetti', () => whatsapp.disconnetti());
  handle('rate:list', (clienteId) => persone.listRate(clienteId));
  handle('persone:get', (clienteId, id) => persone.dettaglioPersona(clienteId, id));
  handle('persone:save', (clienteId, id, data) => persone.salvaPersona(clienteId, id, data));
  handle('percorsi:anteprima', (data) => persone.anteprimaPercorso(data));
  handle('percorsi:tipi', (clienteId) => persone.tipiPercorso(clienteId));
  handle('percorsi:rimuoviTipo', (clienteId, nome) => persone.rimuoviTipoPercorso(clienteId, nome));
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

// Controllo promemoria: all'avvio, ogni 5 minuti e quando WhatsApp si collega.
// L'invio parte solo dopo l'orario impostato (predefinito 12:00).
let controlloInCorso = false;
async function controllaPromemoria() {
  if (!db.isReady() || controlloInCorso) return null;
  controlloInCorso = true;
  try {
    const esito = await promemoria.controllaTutti();
    const msg = [];
    if (esito.email) msg.push(`${esito.email} email inviate`);
    if (esito.whatsapp) msg.push(`${esito.whatsapp} WhatsApp inviati`);
    if (esito.errori) msg.push(`${esito.errori} non inviati (errore)`);
    if (msg.length && Notification.isSupported()) {
      const n = new Notification({ title: 'Promemoria rate', body: msg.join(' · ') });
      n.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
      n.show();
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('promemoria:aggiornati', esito);
    return esito;
  } catch (e) {
    log.warn('Controllo promemoria fallito:', e.message);
    return null;
  } finally {
    controlloInCorso = false;
  }
}

app.whenReady().then(async () => {
  registerIpc();
  try {
    await db.init(config.load().db);
    aggiornaPermessiPortale();
  } catch (err) {
    log.warn('Connessione DB non riuscita all\'avvio:', err.message);
  }
  createWindow();
  setupUpdater(() => mainWindow);
  setTimeout(controllaPromemoria, 15000);
  setInterval(controllaPromemoria, 5 * 60 * 1000);

  // WhatsApp: stato all'interfaccia; appena connesso si inviano i messaggi in attesa
  let eraConnesso = false;
  whatsapp.onCambio((st) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('wa:stato', st);
    if (st.stato === 'connesso' && !eraConnesso) setTimeout(controllaPromemoria, 3000);
    eraConnesso = st.stato === 'connesso';
  });
  // se c'è già una sessione salvata, ci si ricollega da soli
  if (whatsapp.haSessione()) whatsapp.connetti().catch((e) => log.warn('WhatsApp:', e.message));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { db.close(); });
