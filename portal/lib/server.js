// Funzioni comuni delle API del portale: database, sessione, risposte.
const crypto = require('crypto');
const { Pool, types } = require('pg');
const { CLIENTI_VISIBILI } = require('./campi');

// DATE -> 'YYYY-MM-DD', NUMERIC -> number (come nell'app desktop)
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const SESSIONE_MINUTI = 30; // uscita automatica dopo 30 minuti senza attività
const COOKIE = 'zuk_sess';

// ---- Database ------------------------------------------------------------------
const pools = new Map();

function urlDb(dbName) {
  const u = new URL(process.env.DATABASE_URL);
  if (dbName) u.pathname = '/' + dbName;
  return u.toString();
}

function pool(dbName) {
  const k = dbName || '';
  if (!pools.has(k)) {
    const p = new Pool({
      connectionString: urlDb(dbName),
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      ssl: /sslmode=require/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined
    });
    p.on('error', () => {});
    pools.set(k, p);
  }
  return pools.get(k);
}

const master = () => pool(null);

async function clientePerId(id) {
  const { rows } = await master().query(`SELECT ${CLIENTI_VISIBILI.join(', ')} FROM clienti WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function clientePerUtente(utente) {
  const { rows } = await master().query(
    `SELECT ${CLIENTI_VISIBILI.join(', ')} FROM clienti WHERE portale_utente = $1`, [utente]
  );
  return rows[0] || null;
}

// ---- Sessione (cookie firmato, nessun dato salvato sul server) ----------------------
const segreto = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET mancante o troppo corto');
  return s;
};
const b64 = (x) => Buffer.from(x).toString('base64url');
const firma = (dati) => crypto.createHmac('sha256', segreto()).update(dati).digest('base64url');

// cambia quando cambia la password o il nome utente: le sessioni aperte decadono
const versione = (c) => crypto.createHash('sha256').update(`${c.portale_utente}|${c.portale_password_hash}`).digest('base64url').slice(0, 16);

function creaToken(cliente) {
  const dati = b64(JSON.stringify({ c: cliente.id, v: versione(cliente), e: Date.now() + SESSIONE_MINUTI * 60000 }));
  return `${dati}.${firma(dati)}`;
}

function leggiToken(token) {
  const [dati, f] = String(token || '').split('.');
  if (!dati || !f) return null;
  const atteso = firma(dati);
  if (f.length !== atteso.length || !crypto.timingSafeEqual(Buffer.from(f), Buffer.from(atteso))) return null;
  try {
    const t = JSON.parse(Buffer.from(dati, 'base64url').toString());
    return t.e > Date.now() ? t : null;
  } catch {
    return null;
  }
}

function leggiCookie(req) {
  const out = {};
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function impostaCookie(res, valore, maxAgeSec) {
  const sicuro = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${valore}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${sicuro}`);
}

/** Restituisce il cliente autenticato (e rinnova la sessione) oppure risponde 401. */
async function autentica(req, res) {
  const t = leggiToken(leggiCookie(req)[COOKIE]);
  if (!t) return void invia(res, 401, { errore: 'Sessione scaduta: accedi di nuovo' });
  const c = await clientePerId(t.c);
  if (!c || !c.portale_attivo || c.archiviato || versione(c) !== t.v) {
    impostaCookie(res, '', 0);
    return void invia(res, 401, { errore: 'Accesso non più valido: accedi di nuovo' });
  }
  impostaCookie(res, creaToken(c), SESSIONE_MINUTI * 60);
  return c;
}

// ---- Richieste e risposte --------------------------------------------------------
function invia(res, stato, corpo) {
  res.statusCode = stato;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}

async function leggiCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const parti = [];
  for await (const p of req) parti.push(p);
  const testo = Buffer.concat(parti).toString() || '{}';
  return JSON.parse(testo);
}

const query = (req) => Object.fromEntries(new URL(req.url, 'http://x').searchParams);
const ipDi = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

/** Esegue l'handler gestendo gli errori senza esporre dettagli interni. */
const gestisci = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) invia(res, 500, { errore: 'Errore del server, riprova tra poco' });
  }
};

module.exports = {
  pool, master, clientePerId, clientePerUtente, creaToken, autentica, impostaCookie,
  invia, leggiCorpo, query, ipDi, gestisci, SESSIONE_MINUTI
};
