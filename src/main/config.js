// Configurazione locale (connessione Postgres) salvata nella cartella dati dell'utente.
const { app } = require('electron');
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
  }
};

const file = () => path.join(app.getPath('userData'), 'config.json');

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return { ...DEFAULTS, ...saved, db: { ...DEFAULTS.db, ...(saved.db || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(cfg) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
}

module.exports = { load, save };
