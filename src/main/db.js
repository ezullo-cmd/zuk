// Accesso a Postgres.
// - Un DB "master" (zuk_master) con l'anagrafica dei clienti.
// - Un DB separato per ogni cliente (zuk_cliente_<id>) con appuntamenti, fatture e acquisti.
const { Pool, Client, types } = require('pg');
const { hashPassword } = require('../../portal/lib/password');

// DATE -> stringa 'YYYY-MM-DD' (evita slittamenti di fuso), NUMERIC -> number
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

let cfg = null;
let masterPool = null;
const clientPools = new Map();

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const quoteIdent = (name) => {
  if (!IDENT.test(name)) throw new Error(`Nome database non valido: ${name}`);
  return `"${name}"`;
};

function connOpts(database, c = cfg) {
  const { host, port, user, password, ssl } = c;
  return {
    host, port: Number(port), user, password, database,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 20000 // Neon può impiegare qualche secondo a "svegliarsi"
  };
}

// Database "di servizio" a cui collegarsi per creare gli altri.
// Su Neon il database di default si chiama "neondb".
const ADMIN_DBS = ['postgres', 'neondb', 'defaultdb'];

async function adminClient(c = cfg) {
  let lastErr;
  for (const dbName of [...new Set([...ADMIN_DBS, c.masterDb])]) {
    const client = new Client(connOpts(dbName, c));
    try {
      await client.connect();
      return client;
    } catch (e) {
      lastErr = e;
      await client.end().catch(() => {});
      // database inesistente o non accessibile: prova il successivo;
      // altri errori (password errata, rete) li segnaliamo subito
      if (!['3D000', '42501', '28000'].includes(e.code)) throw e;
    }
  }
  throw lastErr;
}

// Le connessioni inattive possono essere chiuse dal server (es. Neon quando va in pausa):
// senza questo handler l'errore farebbe chiudere l'app.
function makePool(database, max) {
  const pool = new Pool({ ...connOpts(database), max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 20000 });
  pool.on('error', (err) => console.warn(`Connessione ${database} chiusa:`, err.message));
  return pool;
}

async function ensureDatabase(name) {
  const admin = await adminClient();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }
}

// ---- Migrazioni ---------------------------------------------------------------
// Per aggiungere modifiche allo schema, aggiungi un nuovo elemento in coda all'array
// (non modificare quelli esistenti): verrà applicato automaticamente a tutti i DB.

const MASTER_MIGRATIONS = [
  `CREATE TABLE clienti (
     id          SERIAL PRIMARY KEY,
     nome        TEXT NOT NULL,
     email       TEXT,
     telefono    TEXT,
     partita_iva TEXT,
     indirizzo   TEXT,
     note        TEXT,
     db_name     TEXT UNIQUE,
     archiviato  BOOLEAN NOT NULL DEFAULT false,
     creato_il   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // v2: colore e sezioni attive nella pagina del cliente
  `ALTER TABLE clienti ADD COLUMN colore TEXT NOT NULL DEFAULT '#2f6fed';
   ALTER TABLE clienti ADD COLUMN sezioni JSONB NOT NULL DEFAULT '["appuntamenti","fatture","acquisti"]'`,
  // v3: logo del cliente (immagine ridimensionata, salvata come data URL)
  `ALTER TABLE clienti ADD COLUMN logo TEXT`,
  // v4: promemoria delle rate (testo personalizzabile, invio email via SMTP del cliente)
  `ALTER TABLE clienti ADD COLUMN promemoria_attivi BOOLEAN NOT NULL DEFAULT false;
   ALTER TABLE clienti ADD COLUMN promemoria_testo TEXT;
   ALTER TABLE clienti ADD COLUMN promemoria_oggetto TEXT;
   ALTER TABLE clienti ADD COLUMN smtp JSONB`,
  // v5: nome del mittente nei promemoria (la casella email è unica, nelle Impostazioni dell'app)
  `ALTER TABLE clienti ADD COLUMN promemoria_mittente TEXT`,
  // v6: accesso al portale web in sola lettura e registro degli accessi
  `ALTER TABLE clienti ADD COLUMN portale_attivo BOOLEAN NOT NULL DEFAULT false;
   ALTER TABLE clienti ADD COLUMN portale_utente TEXT UNIQUE;
   ALTER TABLE clienti ADD COLUMN portale_password_hash TEXT;
   CREATE TABLE portale_accessi (
     id        SERIAL PRIMARY KEY,
     utente    TEXT NOT NULL,
     ip        TEXT,
     riuscito  BOOLEAN NOT NULL,
     quando    TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX portale_accessi_idx ON portale_accessi (utente, quando);`
];

const CLIENT_MIGRATIONS = [
  `CREATE TABLE appuntamenti (
     id        SERIAL PRIMARY KEY,
     titolo    TEXT NOT NULL,
     inizio    TIMESTAMPTZ NOT NULL,
     fine      TIMESTAMPTZ,
     luogo     TEXT,
     note      TEXT,
     creato_il TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE TABLE fatture (
     id          SERIAL PRIMARY KEY,
     numero      TEXT NOT NULL,
     data        DATE NOT NULL DEFAULT CURRENT_DATE,
     descrizione TEXT,
     imponibile  NUMERIC(12,2) NOT NULL DEFAULT 0,
     iva_perc    NUMERIC(5,2)  NOT NULL DEFAULT 22,
     stato       TEXT NOT NULL DEFAULT 'da_pagare',
     note        TEXT,
     creato_il   TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE TABLE acquisti (
     id          SERIAL PRIMARY KEY,
     data        DATE NOT NULL DEFAULT CURRENT_DATE,
     fornitore   TEXT,
     descrizione TEXT NOT NULL,
     importo     NUMERIC(12,2) NOT NULL DEFAULT 0,
     note        TEXT,
     creato_il   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // v2: anagrafica delle persone (clienti dell'attività), rate, documenti; appuntamenti collegati alla persona
  `CREATE TABLE persone (
     id                   SERIAL PRIMARY KEY,
     nome                 TEXT NOT NULL,
     cognome              TEXT NOT NULL,
     data_nascita         DATE,
     sesso                TEXT,
     codice_fiscale       TEXT,
     telefono             TEXT,
     email                TEXT,
     indirizzo            TEXT,
     contatto_emergenza   TEXT,
     obiettivo            TEXT,
     livello              TEXT,
     condizioni_salute    TEXT,
     certificato_scadenza DATE,
     altezza_cm           NUMERIC(5,1),
     peso_kg              NUMERIC(5,1),
     stato                TEXT NOT NULL DEFAULT 'attivo',
     data_inizio          DATE NOT NULL DEFAULT CURRENT_DATE,
     data_fine            DATE,
     tipo_pagamento       TEXT NOT NULL DEFAULT 'mensile',
     importo              NUMERIC(10,2),
     metodo_pagamento     TEXT,
     note                 TEXT,
     creato_il            TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE TABLE documenti (
     id          SERIAL PRIMARY KEY,
     persona_id  INT REFERENCES persone(id) ON DELETE CASCADE,
     nome_file   TEXT NOT NULL,
     mime        TEXT NOT NULL,
     dimensione  INT NOT NULL,
     dati        BYTEA NOT NULL,
     descrizione TEXT,
     caricato_il TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE TABLE pagamenti (
     id           SERIAL PRIMARY KEY,
     persona_id   INT NOT NULL REFERENCES persone(id) ON DELETE CASCADE,
     periodo      DATE,
     importo      NUMERIC(10,2),
     pagato_il    DATE NOT NULL DEFAULT CURRENT_DATE,
     metodo       TEXT,
     esente       BOOLEAN NOT NULL DEFAULT false,
     documento_id INT REFERENCES documenti(id) ON DELETE SET NULL,
     note         TEXT,
     creato_il    TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (persona_id, periodo)
   );
   ALTER TABLE appuntamenti ADD COLUMN persona_id INT REFERENCES persone(id) ON DELETE SET NULL;
   ALTER TABLE appuntamenti ADD COLUMN stato TEXT NOT NULL DEFAULT 'programmato';
   ALTER TABLE appuntamenti ALTER COLUMN titolo DROP NOT NULL;
   CREATE INDEX appuntamenti_persona_idx ON appuntamenti (persona_id, inizio);`,
  // v3: percorsi (personal trainer / nutrizione) con durata e pagamento unico o a rate
  `CREATE TABLE percorsi (
     id             SERIAL PRIMARY KEY,
     persona_id     INT NOT NULL REFERENCES persone(id) ON DELETE CASCADE,
     tipo           TEXT NOT NULL,
     data_inizio    DATE NOT NULL,
     durata_mesi    INT NOT NULL CHECK (durata_mesi > 0),
     importo_totale NUMERIC(10,2),
     modalita       TEXT NOT NULL DEFAULT 'unica',
     numero_rate    INT NOT NULL DEFAULT 1 CHECK (numero_rate > 0),
     note           TEXT,
     creato_il      TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ALTER TABLE pagamenti ADD COLUMN percorso_id INT REFERENCES percorsi(id) ON DELETE CASCADE;
   ALTER TABLE pagamenti ADD COLUMN numero_rata INT;
   ALTER TABLE pagamenti ADD CONSTRAINT pagamenti_rata_unica UNIQUE (percorso_id, numero_rata);
   ALTER TABLE persone ALTER COLUMN tipo_pagamento SET DEFAULT 'percorso';`,
  // v4: un percorso può essere il rinnovo di un percorso precedente
  `ALTER TABLE percorsi ADD COLUMN rinnovo_di INT REFERENCES percorsi(id) ON DELETE SET NULL;`,
  // v5: canale delle comunicazioni e registro dei promemoria inviati
  `ALTER TABLE persone ADD COLUMN canale_comunicazione TEXT;
   CREATE TABLE promemoria (
     id           SERIAL PRIMARY KEY,
     chiave       TEXT NOT NULL UNIQUE,
     persona_id   INT NOT NULL REFERENCES persone(id) ON DELETE CASCADE,
     percorso_id  INT REFERENCES percorsi(id) ON DELETE CASCADE,
     numero_rata  INT,
     scadenza     DATE NOT NULL,
     canale       TEXT NOT NULL,
     destinatario TEXT,
     testo        TEXT NOT NULL,
     stato        TEXT NOT NULL DEFAULT 'da_inviare',
     errore       TEXT,
     creato_il    TIMESTAMPTZ NOT NULL DEFAULT now(),
     inviato_il   TIMESTAMPTZ
   );`,
  // v6: ultimo tentativo di invio (gli errori si ritentano al massimo una volta l'ora)
  `ALTER TABLE promemoria ADD COLUMN ultimo_tentativo TIMESTAMPTZ`,
  // v7: scadenza della 1ª rata scelta a mano (le successive cadono lo stesso giorno del mese)
  `ALTER TABLE percorsi ADD COLUMN prima_scadenza DATE`
];

async function migrate(pool, migrations) {
  const c = await pool.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS schema_version (version INT NOT NULL)');
    const { rows } = await c.query('SELECT version FROM schema_version');
    let version = rows.length ? rows[0].version : 0;
    if (!rows.length) await c.query('INSERT INTO schema_version VALUES (0)');
    for (; version < migrations.length; version++) {
      await c.query('BEGIN');
      try {
        await c.query(migrations[version]);
        await c.query('UPDATE schema_version SET version = $1', [version + 1]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    c.release();
  }
}

// ---- Connessione --------------------------------------------------------------

async function close() {
  const pools = [masterPool, ...clientPools.values()].filter(Boolean);
  masterPool = null;
  clientPools.clear();
  await Promise.allSettled(pools.map((p) => p.end()));
}

async function init(dbConfig) {
  await close();
  cfg = dbConfig;
  await ensureDatabase(cfg.masterDb);
  masterPool = makePool(cfg.masterDb, 5);
  await migrate(masterPool, MASTER_MIGRATIONS);
}

const isReady = () => !!masterPool;

function requireMaster() {
  if (!masterPool) throw new Error('Database non connesso. Configura la connessione nelle Impostazioni.');
  return masterPool;
}

async function poolForCliente(clienteId) {
  if (clientPools.has(clienteId)) return clientPools.get(clienteId);
  const { rows } = await requireMaster().query('SELECT db_name FROM clienti WHERE id = $1', [clienteId]);
  if (!rows.length) throw new Error('Cliente non trovato');
  const pool = makePool(rows[0].db_name, 3);
  await migrate(pool, CLIENT_MIGRATIONS); // porta il DB del cliente all'ultima versione
  clientPools.set(clienteId, pool);
  return pool;
}

// ---- Clienti (DB master) ------------------------------------------------------

const CLIENTE_FIELDS = [
  'nome', 'email', 'telefono', 'partita_iva', 'indirizzo', 'note', 'colore', 'sezioni', 'logo',
  'promemoria_attivi', 'promemoria_testo', 'promemoria_oggetto', 'promemoria_mittente',
  'portale_attivo', 'portale_utente', 'portale_password_hash'
];

// Dati del cliente per l'interfaccia: l'impronta della password del portale non esce mai
function pubblico(c) {
  if (!c) return c;
  const { portale_password_hash, ...resto } = c;
  return { ...resto, portale_ha_password: !!portale_password_hash };
}

/** Converte la password del portale in impronta e controlla che l'accesso sia completo. */
async function preparaPortale(data, esistente = {}) {
  const d = { ...data };
  delete d.portale_password_hash; // mai accettato dall'interfaccia
  if (d.portale_password) {
    if (String(d.portale_password).length < 8) throw new Error('La password del portale deve avere almeno 8 caratteri');
    d.portale_password_hash = hashPassword(d.portale_password);
  }
  delete d.portale_password;
  const attivo = 'portale_attivo' in d ? !!d.portale_attivo : !!esistente.portale_attivo;
  const utente = 'portale_utente' in d ? d.portale_utente : esistente.portale_utente;
  const haPassword = !!(d.portale_password_hash || esistente.portale_password_hash);
  if (attivo && (!utente || !haPassword)) throw new Error('Per attivare il portale servono nome utente e password');
  return d;
}

const erroreUtenteDuplicato = (e) => {
  if (e.code === '23505' && /portale_utente/.test(e.constraint || e.detail || '')) {
    throw new Error('Questo nome utente del portale è già usato da un altro cliente');
  }
  throw e;
};

// Sezioni che si possono attivare nella pagina di un cliente
const SEZIONI = ['anagrafica', 'appuntamenti', 'servizi', 'pagamenti', 'fatture', 'acquisti'];

function clienteValue(field, value) {
  if (field === 'colore') {
    if (!/^#[0-9a-f]{6}$/i.test(value || '')) throw new Error('Colore non valido');
    return value.toLowerCase();
  }
  if (field === 'logo') {
    if (!value) return null;
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Logo non valido');
    if (value.length > 2_000_000) throw new Error('Logo troppo grande');
    return value;
  }
  if (field === 'promemoria_attivi' || field === 'portale_attivo') return !!value;
  if (field === 'portale_password_hash') return value;
  if (field === 'portale_utente') {
    const u = String(value || '').trim().toLowerCase();
    if (!u) return null;
    if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw new Error('Nome utente del portale: 3-40 caratteri tra lettere, numeri, punto, trattino');
    return u;
  }
  if (field === 'smtp') {
    if (!value || !value.host) return null;
    const { host, port, secure, user, password, mittente } = value;
    return JSON.stringify({ host: String(host).trim(), port: Number(port) || 587, secure: !!secure, user, password, mittente });
  }
  if (field === 'sezioni') {
    const list = (Array.isArray(value) ? value : []).filter((s) => SEZIONI.includes(s));
    if (!list.length) throw new Error('Seleziona almeno una sezione');
    return JSON.stringify([...new Set(list)]);
  }
  return value === '' ? null : value ?? null;
}

async function listClienti({ includiArchiviati = false } = {}) {
  const { rows } = await requireMaster().query(
    `SELECT * FROM clienti ${includiArchiviati ? '' : 'WHERE NOT archiviato'} ORDER BY nome`
  );
  return rows.map(pubblico);
}

async function getClienteCompleto(id) {
  const { rows } = await requireMaster().query('SELECT * FROM clienti WHERE id = $1', [id]);
  return rows[0] || null;
}

const getCliente = async (id) => pubblico(await getClienteCompleto(id));

async function createCliente(input) {
  const master = requireMaster();
  const data = await preparaPortale(input);
  const fields = CLIENTE_FIELDS.filter((f) => data[f] !== undefined);
  const vals = fields.map((f) => clienteValue(f, data[f]));
  const { rows } = await master.query(
    `INSERT INTO clienti (${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    vals
  ).catch(erroreUtenteDuplicato);
  const id = rows[0].id;
  const dbName = `${cfg.clientDbPrefix}${id}`;
  try {
    await ensureDatabase(dbName);
    await master.query('UPDATE clienti SET db_name = $1 WHERE id = $2', [dbName, id]);
    await poolForCliente(id);
  } catch (e) {
    await master.query('DELETE FROM clienti WHERE id = $1', [id]);
    throw e;
  }
  return getCliente(id);
}

async function updateCliente(id, input) {
  const data = await preparaPortale(input, (await getClienteCompleto(id)) || {});
  const fields = CLIENTE_FIELDS.filter((f) => f in data);
  if (fields.length) {
    await requireMaster().query(
      `UPDATE clienti SET ${fields.map((f, i) => `${f} = $${i + 1}`).join(', ')} WHERE id = $${fields.length + 1}`,
      [...fields.map((f) => clienteValue(f, data[f])), id]
    ).catch(erroreUtenteDuplicato);
  }
  return getCliente(id);
}

async function setArchiviato(id, archiviato) {
  await requireMaster().query('UPDATE clienti SET archiviato = $1 WHERE id = $2', [!!archiviato, id]);
  return getCliente(id);
}

// ---- Dati del cliente (DB dedicato) -------------------------------------------

const TABLES = {
  appuntamenti: {
    fields: ['persona_id', 'titolo', 'inizio', 'fine', 'luogo', 'stato', 'note'],
    order: 'inizio DESC',
    select: `SELECT a.*, p.nome || ' ' || p.cognome AS persona_nome
               FROM appuntamenti a LEFT JOIN persone p ON p.id = a.persona_id`
  },
  fatture: { fields: ['numero', 'data', 'descrizione', 'imponibile', 'iva_perc', 'stato', 'note'], order: 'data DESC, id DESC' },
  acquisti: { fields: ['data', 'fornitore', 'descrizione', 'importo', 'note'], order: 'data DESC, id DESC' },
  persone: {
    fields: [
      'nome', 'cognome', 'data_nascita', 'sesso', 'codice_fiscale', 'telefono', 'email', 'indirizzo',
      'contatto_emergenza', 'obiettivo', 'livello', 'condizioni_salute', 'certificato_scadenza',
      'altezza_cm', 'peso_kg', 'stato', 'data_inizio', 'data_fine', 'tipo_pagamento', 'importo',
      'metodo_pagamento', 'note', 'canale_comunicazione'
    ],
    order: 'cognome, nome'
  },
  pagamenti: {
    fields: ['persona_id', 'periodo', 'importo', 'pagato_il', 'metodo', 'esente', 'documento_id', 'note', 'percorso_id', 'numero_rata'],
    order: 'periodo DESC NULLS LAST, pagato_il DESC'
  },
  percorsi: {
    fields: ['persona_id', 'tipo', 'data_inizio', 'durata_mesi', 'importo_totale', 'modalita', 'numero_rate', 'note', 'rinnovo_di', 'prima_scadenza'],
    order: 'data_inizio DESC'
  }
};

function table(name) {
  const t = TABLES[name];
  if (!t) throw new Error(`Tabella non valida: ${name}`);
  return t;
}

const clean = (v) => (v === '' ? null : v);

async function list(clienteId, name) {
  const t = table(name);
  const pool = await poolForCliente(clienteId);
  const { rows } = await pool.query(`${t.select || `SELECT * FROM ${name}`} ORDER BY ${t.order}`);
  return rows;
}

async function create(clienteId, name, data) {
  const t = table(name);
  const fields = t.fields.filter((f) => data[f] !== undefined && data[f] !== '');
  const pool = await poolForCliente(clienteId);
  const sql = fields.length
    ? `INSERT INTO ${name} (${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`
    : `INSERT INTO ${name} DEFAULT VALUES RETURNING *`;
  const { rows } = await pool.query(sql, fields.map((f) => clean(data[f])));
  return rows[0];
}

async function update(clienteId, name, id, data) {
  const t = table(name);
  const fields = t.fields.filter((f) => f in data);
  const pool = await poolForCliente(clienteId);
  if (!fields.length) return (await pool.query(`SELECT * FROM ${name} WHERE id = $1`, [id])).rows[0];
  const { rows } = await pool.query(
    `UPDATE ${name} SET ${fields.map((f, i) => `${f} = $${i + 1}`).join(', ')} WHERE id = $${fields.length + 1} RETURNING *`,
    [...fields.map((f) => clean(data[f])), id]
  );
  return rows[0];
}

async function remove(clienteId, name, id) {
  table(name);
  const pool = await poolForCliente(clienteId);
  await pool.query(`DELETE FROM ${name} WHERE id = $1`, [id]);
  return true;
}

// ---- Pagina iniziale ----------------------------------------------------------

async function dashboard() {
  const clienti = await listClienti();
  const prossimi = [];
  const ritardi = [];
  let daIncassare = 0;
  let fattureAperte = 0;
  await Promise.all(
    clienti.map(async (c) => {
      const pool = await poolForCliente(c.id);
      const app = await pool.query(
        `${TABLES.appuntamenti.select}
          WHERE a.inizio >= now() - interval '1 hour' AND a.stato = 'programmato' ORDER BY a.inizio LIMIT 10`
      );
      app.rows.forEach((r) => prossimi.push({ ...r, cliente_id: c.id, cliente_nome: c.nome, cliente_colore: c.colore }));
      const persone = await require('./persone').listPersone(c.id);
      persone
        .filter((p) => p.situazione.inRitardo.length)
        .forEach((p) => ritardi.push({
          cliente_id: c.id, cliente_nome: c.nome, cliente_colore: c.colore,
          persona_id: p.id, persona_nome: `${p.nome} ${p.cognome}`, rate: p.situazione.inRitardo
        }));
      const f = await pool.query(
        `SELECT count(*)::int AS n, coalesce(sum(imponibile * (1 + iva_perc / 100)), 0) AS tot
           FROM fatture WHERE stato = 'da_pagare'`
      );
      fattureAperte += f.rows[0].n;
      daIncassare += Number(f.rows[0].tot);
    })
  );
  prossimi.sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  return { numClienti: clienti.length, prossimi: prossimi.slice(0, 15), fattureAperte, daIncassare, ritardi };
}

async function testConnection(dbConfig) {
  const c = await adminClient(dbConfig);
  const { rows } = await c.query('SELECT version()');
  await c.end();
  return rows[0].version;
}

module.exports = {
  init, close, isReady, testConnection,
  listClienti, getCliente, createCliente, updateCliente, setArchiviato,
  list, create, update, remove, dashboard, poolForCliente, requireMaster, getConfig: () => cfg
};
