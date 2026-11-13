// Collegamento a WhatsApp Web (come un "dispositivo collegato") tramite QR code.
// La sessione viene salvata nella cartella dati dell'app: dopo il primo collegamento
// l'app si ricollega da sola a ogni avvio, finché non si preme "Disconnetti"
// o si rimuove il dispositivo dal telefono.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const authDir = () => path.join(app.getPath('userData'), 'whatsapp-auth');

let sock = null;
let stato = { stato: 'disconnesso', qr: null, numero: null, errore: null };
let ascoltatori = [];
let chiusuraVoluta = false;
let tentativi = 0;

function aggiorna(parziale) {
  stato = { ...stato, ...parziale };
  ascoltatori.forEach((fn) => fn(stato));
}

const onCambio = (fn) => { ascoltatori.push(fn); };
const getStato = () => stato;
const connesso = () => stato.stato === 'connesso' && !!sock;
const haSessione = () => fs.existsSync(path.join(authDir(), 'creds.json'));

async function connetti() {
  if (sock && (stato.stato === 'connesso' || stato.stato === 'qr' || stato.stato === 'connessione')) return stato;
  chiusuraVoluta = false;
  aggiorna({ stato: 'connessione', qr: null, errore: null });

  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = baileys;
  const pino = (await import('pino')).default;

  const { state, saveCreds } = await useMultiFileAuthState(authDir());
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch { /* usa la versione predefinita della libreria */ }

  sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
    browser: Browsers.appropriate('Desktop'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    if (u.qr) aggiorna({ stato: 'qr', qr: await QRCode.toDataURL(u.qr, { margin: 1, width: 280 }) });
    if (u.connection === 'open') {
      tentativi = 0;
      const numero = (sock.user?.id || '').split(':')[0].split('@')[0];
      aggiorna({ stato: 'connesso', qr: null, numero, errore: null });
    }
    if (u.connection === 'close') {
      const codice = u.lastDisconnect?.error?.output?.statusCode;
      sock = null;
      if (chiusuraVoluta) return aggiorna({ stato: 'disconnesso', qr: null, numero: null });
      if (codice === DisconnectReason.loggedOut) {
        // dispositivo rimosso dal telefono: serve un nuovo QR
        fs.rmSync(authDir(), { recursive: true, force: true });
        return aggiorna({ stato: 'disconnesso', qr: null, numero: null, errore: 'Disconnesso dal telefono' });
      }
      // caduta di rete o riavvio richiesto da WhatsApp: riprova
      if (tentativi++ < 10) {
        aggiorna({ stato: 'connessione', qr: null });
        setTimeout(() => connetti().catch((e) => aggiorna({ stato: 'disconnesso', errore: e.message })), Math.min(30000, 2000 * tentativi));
      } else aggiorna({ stato: 'disconnesso', qr: null, errore: 'Impossibile collegarsi a WhatsApp' });
    }
  });
  return stato;
}

/** Interrompe la richiesta del QR senza cancellare una sessione esistente. */
function annulla() {
  if (stato.stato === 'connesso') return stato;
  chiusuraVoluta = true;
  try { sock?.end(undefined); } catch { /* già chiuso */ }
  sock = null;
  aggiorna({ stato: 'disconnesso', qr: null });
  return stato;
}

/** Scollega il dispositivo: al prossimo collegamento servirà di nuovo il QR. */
async function disconnetti() {
  chiusuraVoluta = true;
  try { await sock?.logout(); } catch { /* già scollegato */ }
  try { sock?.end(undefined); } catch { /* già chiuso */ }
  sock = null;
  fs.rmSync(authDir(), { recursive: true, force: true });
  aggiorna({ stato: 'disconnesso', qr: null, numero: null, errore: null });
  return stato;
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Invia un messaggio di testo. `numero` solo cifre con prefisso internazionale (es. 393471234567). */
async function invia(numero, testo) {
  if (!connesso()) throw new Error('WhatsApp non connesso');
  const [info] = await sock.onWhatsApp(numero);
  if (!info?.exists) throw new Error(`Il numero +${numero} non risulta su WhatsApp`);
  await sock.sendMessage(info.jid, { text: testo });
  // pausa tra un messaggio e l'altro per non sembrare un invio di massa
  await pausa(4000 + Math.random() * 5000);
}

module.exports = { connetti, annulla, disconnetti, invia, connesso, getStato, onCambio, haSessione };
