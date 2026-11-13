// Configurazione locale (connessione Postgres) salvata nella cartella dati dell'utente.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  db: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '',
    ssl: false,
    // DB "anagrafica" che contiene l'elenco dei clienti
    masterDb: 'zuk_master',
    // Prefisso dei DB dedicati a ogni cliente: zuk_cliente_<id>
    clientDbPrefix: 'zuk_cliente_'
  },
  // Casella unica da cui partono i promemoria email (es. Gmail con "password per le app")
  email: {
    user: '',
    passwordCifrata: '',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true
  },
  // Orario dal quale partono i promemoria del giorno
  orarioPromemoria: '12:00'
};

const file = () => path.join(app.getPath('userData'), 'config.json');

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return {
      ...DEFAULTS, ...saved,
      db: { ...DEFAULTS.db, ...(saved.db || {}) },
      email: { ...DEFAULTS.email, ...(saved.email || {}) }
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(cfg) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
}

// La password email viene cifrata con il portachiavi del sistema operativo (quando disponibile)
function cifra(testo) {
  if (!testo) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(testo).toString('base64');
  return 'b64:' + Buffer.from(testo, 'utf8').toString('base64');
}

function decifra(valore) {
  if (!valore) return '';
  if (valore.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(valore.slice(4), 'base64'));
  if (valore.startsWith('b64:')) return Buffer.from(valore.slice(4), 'base64').toString('utf8');
  return '';
}

/** Impostazioni email complete di password in chiaro (solo per il processo principale). */
function emailConfig() {
  const e = load().email;
  return { ...e, password: decifra(e.passwordCifrata) };
}

module.exports = { load, save, cifra, decifra, emailConfig };
