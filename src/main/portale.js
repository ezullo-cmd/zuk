// Portale web in sola lettura: utente del database dedicato (zuk_portale) con permessi minimi.
// - può leggere solo i campi non sanitari delle persone e i dati di rate, percorsi, appuntamenti, ecc.;
// - nel database principale legge solo nome/logo/colore/sezioni e le credenziali del portale dei clienti;
// - può solo aggiungere righe al registro degli accessi (per bloccare i tentativi ripetuti).
const crypto = require('crypto');
const { Client } = require('pg');
const db = require('./db');

const RUOLO = 'zuk_portale';

const { PERSONE_VISIBILI, CLIENTI_VISIBILI, TABELLE_CLIENTE } = require('../../portal/lib/campi');

const quote = (n) => `"${String(n).replace(/"/g, '""')}"`;

async function esisteRuolo(client) {
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [RUOLO]);
  return rowCount > 0;
}

/** Permessi nel database di un cliente (le tabelle mancanti vengono saltate). */
async function permessiCliente(pool, dbName) {
  await pool.query(`GRANT CONNECT ON DATABASE ${quote(dbName)} TO ${RUOLO}`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${RUOLO}`);
  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
    [[...TABELLE_CLIENTE, 'persone']]
  );
  const presenti = new Set(rows.map((r) => r.table_name));
  for (const t of TABELLE_CLIENTE) if (presenti.has(t)) await pool.query(`GRANT SELECT ON ${t} TO ${RUOLO}`);
  if (presenti.has('persone')) {
    // nessun permesso sull'intera tabella: solo sulle colonne non sanitarie
    await pool.query(`REVOKE SELECT ON persone FROM ${RUOLO}`);
    await pool.query(`GRANT SELECT (${PERSONE_VISIBILI.join(', ')}) ON persone TO ${RUOLO}`);
  }
}

async function permessiMaster(master, masterDb) {
  await master.query(`GRANT CONNECT ON DATABASE ${quote(masterDb)} TO ${RUOLO}`);
  await master.query(`GRANT USAGE ON SCHEMA public TO ${RUOLO}`);
  await master.query(`REVOKE SELECT ON clienti FROM ${RUOLO}`);
  await master.query(`GRANT SELECT (${CLIENTI_VISIBILI.join(', ')}) ON clienti TO ${RUOLO}`);
  await master.query(`GRANT SELECT, INSERT ON portale_accessi TO ${RUOLO}`);
  await master.query(`GRANT USAGE ON SEQUENCE portale_accessi_id_seq TO ${RUOLO}`);
}

/** Applica (o riapplica) i permessi a tutti i database, se l'utente del portale esiste. */
async function applicaPermessi() {
  if (!db.isReady()) return false;
  const master = db.requireMaster();
  if (!(await esisteRuolo(master))) return false;
  await permessiMaster(master, db.getConfig().masterDb);
  for (const c of await db.listClienti({ includiArchiviati: true })) {
    if (!c.db_name) continue;
    try {
      await permessiCliente(await db.poolForCliente(c.id), c.db_name);
    } catch (e) {
      console.warn(`Permessi portale ${c.nome}:`, e.message);
    }
  }
  return true;
}

/** Host "pooled" di Neon (consigliato per i server come Vercel). */
function hostPooled(host) {
  return /^ep-[^.]+\.[^.]+.*neon\.tech$/.test(host) && !host.includes('-pooler.')
    ? host.replace(/^(ep-[^.]+)\./, '$1-pooler.')
    : host;
}

/**
 * Crea l'utente del portale (o ne rigenera la password) e applica i permessi.
 * Restituisce i valori da inserire su Vercel: DATABASE_URL e SESSION_SECRET.
 */
async function creaAccessoDb() {
  if (!db.isReady()) throw new Error('Database non connesso');
  const cfg = db.getConfig();
  const password = crypto.randomBytes(24).toString('base64url');
  const master = db.requireMaster();
  try {
    if (await esisteRuolo(master)) await master.query(`ALTER ROLE ${RUOLO} WITH LOGIN PASSWORD '${password}'`);
    else await master.query(`CREATE ROLE ${RUOLO} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  } catch (e) {
    throw new Error(`Impossibile creare l'utente del portale (${e.message}). L'utente del database deve avere il permesso CREATEROLE.`);
  }
  await applicaPermessi();

  // verifica: il nuovo utente si collega e NON vede i campi sanitari
  const prova = new Client({
    host: cfg.host, port: Number(cfg.port), user: RUOLO, password, database: cfg.masterDb,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false
  });
  await prova.connect();
  await prova.query('SELECT id, nome FROM clienti LIMIT 1');
  await prova.end();

  const url = `postgresql://${RUOLO}:${password}@${hostPooled(cfg.host)}:${cfg.port}/${cfg.masterDb}${cfg.ssl ? '?sslmode=require' : ''}`;
  return { databaseUrl: url, sessionSecret: crypto.randomBytes(32).toString('base64url') };
}

/** Ultimi accessi al portale di un cliente. */
async function ultimiAccessi(utente, limite = 10) {
  if (!utente) return [];
  const { rows } = await db.requireMaster().query(
    'SELECT quando, riuscito, ip FROM portale_accessi WHERE utente = $1 ORDER BY quando DESC LIMIT $2',
    [utente, limite]
  );
  return rows;
}

module.exports = { RUOLO, PERSONE_VISIBILI, applicaPermessi, creaAccessoDb, ultimiAccessi, hostPooled };
