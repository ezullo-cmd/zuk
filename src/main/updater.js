// Aggiornamenti automatici tramite GitHub Releases (electron-updater).
// All'avvio controlla se esiste una nuova versione: se sì mostra una notifica di sistema
// e un banner nell'app; l'utente sceglie se scaricarla e poi riavviare per installarla.
const { app, ipcMain, Notification, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const CHECK_EVERY_MS = 30 * 60 * 1000;

// Su Mac senza certificato Apple macOS non accetta l'installazione automatica:
// si avvisa della nuova versione e si apre la pagina da cui scaricarla.
const MANUALE = process.platform === 'darwin';
// Nota: nell'app pacchettizzata package.json non contiene la sezione "build": il repository va scritto qui
const REPO_RILASCI = { owner: 'ezullo-cmd', repo: 'zuk' };
const { owner, repo } = REPO_RILASCI;
const paginaVersione = (v) => `https://github.com/${owner}/${repo}/releases/tag/v${v}`;

function setupUpdater(getWindow) {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (type, payload = {}) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('updater:event', { type, ...payload });
  };

  const notify = (title, body) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', () => {
      const win = getWindow();
      if (win) { win.show(); win.focus(); }
    });
    n.show();
  };

  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-not-available', () => send('not-available'));
  autoUpdater.on('update-available', (info) => {
    send('available', { version: info.version, releaseNotes: info.releaseNotes, manuale: MANUALE });
    notify('Nuova versione disponibile', MANUALE
      ? `Zuk Gestionale ${info.version}: scarica il nuovo installer dalla pagina che si apre con "Scarica".`
      : `Zuk Gestionale ${info.version} è pronta per essere installata.`);
  });
  autoUpdater.on('download-progress', (p) => send('progress', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    send('downloaded', { version: info.version });
    notify('Aggiornamento scaricato', 'Riavvia l\'app per completare l\'aggiornamento.');
  });
  autoUpdater.on('error', (err) => send('error', { message: err?.message || String(err) }));

  ipcMain.handle('updater:check', async () => { await check(); });
  ipcMain.handle('updater:download', async () => {
    await autoUpdater.downloadUpdate().catch((e) => send('error', { message: e.message }));
  });
  ipcMain.handle('updater:pagina', (_e, versione) => shell.openExternal(paginaVersione(versione)));
  ipcMain.handle('updater:install', () => setImmediate(() => autoUpdater.quitAndInstall(false, true)));

  function check() {
    if (!app.isPackaged) {
      send('dev', { message: 'Controllo aggiornamenti disattivato in sviluppo' });
      return null;
    }
    return autoUpdater.checkForUpdates().catch((e) => log.warn('check update failed', e));
  }

  check();
  setInterval(check, CHECK_EVERY_MS);
}

module.exports = { setupUpdater };
