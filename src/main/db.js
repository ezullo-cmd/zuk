// Accesso a Postgres.
// - Un DB "master" (zuk_master) con l'anagrafica dei clienti.
// - Un DB separato per ogni cliente (zuk_cliente_<id>) con appuntamenti, fatture e acquisti.
const { Pool, Client, types } = require('pg');

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
   ALTER TABLE clienti ADD COLUMN sezioni JSONB NOT NULL DEFAULT '["appuntamenti","fatture","acquisti"]'`
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
   )`
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

const CLIENTE_FIELDS = ['nome', 'email', 'telefono', 'partita_iva', 'indirizzo', 'note', 'colore', 'sezioni'];

// Sezioni che si possono attivare nella pagina di un cliente
const SEZIONI = ['anagrafica', 'appuntamenti', 'servizi', 'pagamenti', 'fatture', 'acquisti'];

function clienteValue(field, value) {
  if (field === 'colore') {
    if (!/^#[0-9a-f]{6}$/i.test(value || '')) throw new Error('Colore non valido');
    return value.toLowerCase();
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
  return rows;
}

async function getCliente(id) {
  const { rows } = await requireMaster().query('SELECT * FROM clienti WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createCliente(data) {
  const master = requireMaster();
  const fields = CLIENTE_FIELDS.filter((f) => data[f] !== undefined);
  const vals = fields.map((f) => clienteValue(f, data[f]));
  const { rows } = await master.query(
    `INSERT INTO clienti (${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    vals
  );
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

async function updateCliente(id, data) {
  const fields = CLIENTE_FIELDS.filter((f) => f in data);
  if (fields.length) {
    await requireMaster().query(
      `UPDATE clienti SET ${fields.map((f, i) => `${f} = $${i + 1}`).join(', ')} WHERE id = $${fields.length + 1}`,
      [...fields.map((f) => clienteValue(f, data[f])), id]
    );
  }
  return getCliente(id);
}

async function setArchiviato(id, archiviato) {
  await requireMaster().query('UPDATE clienti SET archiviato = $1 WHERE id = $2', [!!archiviato, id]);
  return getCliente(id);
}

// ---- Dati del cliente (DB dedicato) -------------------------------------------

const TABLES = {
  appuntamenti: { fields: ['titolo', 'inizio', 'fine', 'luogo', 'note'], order: 'inizio DESC' },
  fatture: { fields: ['numero', 'data', 'descrizione', 'imponibile', 'iva_perc', 'stato', 'note'], order: 'data DESC, id DESC' },
  acquisti: { fields: ['data', 'fornitore', 'descrizione', 'importo', 'note'], order: 'data DESC, id DESC' }
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
  const { rows } = await pool.query(`SELECT * FROM ${name} ORDER BY ${t.order}`);
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
  let daIncassare = 0;
  let fattureAperte = 0;
  await Promise.all(
    clienti.map(async (c) => {
      const pool = await poolForCliente(c.id);
      const app = await pool.query(
        `SELECT * FROM appuntamenti WHERE inizio >= now() - interval '1 hour' ORDER BY inizio LIMIT 10`
      );
      app.rows.forEach((r) => prossimi.push({ ...r, cliente_id: c.id, cliente_nome: c.nome }));
      const f = await pool.query(
        `SELECT count(*)::int AS n, coalesce(sum(imponibile * (1 + iva_perc / 100)), 0) AS tot
           FROM fatture WHERE stato <> 'pagata'`
      );
      fattureAperte += f.rows[0].n;
      daIncassare += Number(f.rows[0].tot);
    })
  );
  prossimi.sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  return { numClienti: clienti.length, prossimi: prossimi.slice(0, 15), fattureAperte, daIncassare };
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
  list, create, update, remove, dashboard
};
