// Promemoria delle rate in scadenza.
// 5 giorni lavorativi prima della scadenza di una rata non pagata:
// - canale "email": invio automatico tramite l'SMTP configurato per il cliente;
// - canale "telefono": il messaggio viene messo in coda e si invia su WhatsApp con un clic
//   (l'app apre WhatsApp con numero e testo già pronti).
const nodemailer = require('nodemailer');
const db = require('./db');
const persone = require('./persone');

const GIORNI_PRIMA = 5;
const TESTO_DEFAULT =
  'Salve <nome>, le ricordiamo che in data <data di scadenza> scadrà la prossima rata del percorso <tipo percorso>.';
const OGGETTO_DEFAULT = 'Promemoria scadenza rata';
const TIPI_PERCORSO = { personal: 'Personal trainer', nutrizione: 'Nutrizione', personal_nutrizione: 'Personal trainer + Nutrizione' };

// ---- Giorni lavorativi (lun-ven, escluse le festività nazionali italiane) ----------
const pad = (n) => String(n).padStart(2, '0');
const isoUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function pasqua(y) {
  // algoritmo di Gauss/Meeus per la domenica di Pasqua
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mese - 1, giorno));
}

function festivo(d) {
  const md = isoUTC(d).slice(5);
  if (['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26'].includes(md)) return true;
  const pasquetta = pasqua(d.getUTCFullYear());
  pasquetta.setUTCDate(pasquetta.getUTCDate() + 1);
  return isoUTC(pasquetta) === isoUTC(d);
}

const lavorativo = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !festivo(d);

/** Data di invio: N giorni lavorativi prima della scadenza ('YYYY-MM-DD'). */
function dataInvio(scadenza, giorni = GIORNI_PRIMA) {
  const d = new Date(scadenza + 'T00:00:00Z');
  let n = 0;
  while (n < giorni) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (lavorativo(d)) n++;
  }
  return isoUTC(d);
}

// ---- Testo -------------------------------------------------------------------
const dataIT = (iso) => iso.split('-').reverse().join('/');
const euro = (n) => (n === null || n === undefined ? '' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n));

function componiTesto(modello, persona, rata) {
  const valori = {
    nome: persona.nome,
    cognome: persona.cognome,
    'data di scadenza': dataIT(rata.scadenza),
    'tipo percorso': TIPI_PERCORSO[rata.tipo_percorso] || 'in corso',
    importo: euro(rata.importo),
    'numero rata': rata.numero_rata ? `${rata.numero_rata} di ${rata.di}` : ''
  };
  return (modello || TESTO_DEFAULT).replace(/<([^<>]+)>/g, (m, k) => {
    const v = valori[k.trim().toLowerCase()];
    return v === undefined ? m : v;
  });
}

// ---- Numeri di telefono e WhatsApp --------------------------------------------
function numeroWhatsApp(tel) {
  let n = String(tel || '').replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (/^3\d{8,9}$/.test(n)) n = '39' + n; // cellulare italiano senza prefisso
  return n.length >= 8 ? n : null;
}

const linkWhatsApp = (tel, testo) => {
  const n = numeroWhatsApp(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(testo)}` : null;
};

// ---- Email ---------------------------------------------------------------------
function trasporto(smtp) {
  if (!smtp?.host) throw new Error('Configura l\'invio email nelle impostazioni del cliente (server SMTP)');
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined
  });
}

async function inviaEmail(cliente, a, oggetto, testo) {
  const smtp = cliente.smtp;
  await trasporto(smtp).sendMail({
    from: smtp.mittente ? `"${smtp.mittente.replace(/"/g, '')}" <${smtp.user}>` : smtp.user,
    to: a,
    subject: oggetto || OGGETTO_DEFAULT,
    text: testo
  });
}

// ---- Controllo periodico -------------------------------------------------------
const oggiISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * Per ogni rata non pagata la cui data di invio è arrivata (e non è ancora scaduta)
 * crea il promemoria una sola volta: le email partono subito, i WhatsApp restano "da inviare".
 */
async function controllaCliente(cliente, oggi = oggiISO()) {
  if (!cliente.promemoria_attivi) return { email: 0, whatsapp: 0, errori: 0 };
  const pool = await db.poolForCliente(cliente.id);
  const [{ rate }, anagrafica, esistenti] = await Promise.all([
    persone.listRate(cliente.id),
    pool.query('SELECT id, nome, cognome, telefono, email, canale_comunicazione, stato FROM persone'),
    pool.query("SELECT chiave, stato FROM promemoria")
  ]);
  const pers = new Map(anagrafica.rows.map((p) => [p.id, p]));
  const giaFatti = new Map(esistenti.rows.map((r) => [r.chiave, r.stato]));
  const esito = { email: 0, whatsapp: 0, errori: 0 };

  for (const r of rate) {
    if (r.stato !== 'da_pagare' || !r.scadenza) continue;
    if (oggi < dataInvio(r.scadenza) || oggi > r.scadenza) continue;
    const p = pers.get(r.persona.id);
    if (!p || p.stato === 'cessato' || !p.canale_comunicazione) continue;
    const chiave = r.percorso_id ? `perc-${r.percorso_id}-${r.numero_rata}` : `abb-${p.id}-${r.periodo}`;
    const prima = giaFatti.get(chiave);
    if (prima === 'inviato' || prima === 'da_inviare') continue;

    const canale = p.canale_comunicazione === 'email' ? 'email' : 'whatsapp';
    const destinatario = canale === 'email' ? p.email : p.telefono;
    const testo = componiTesto(cliente.promemoria_testo, p, r);
    let stato = 'da_inviare';
    let errore = null;
    if (canale === 'email') {
      try {
        if (!destinatario) throw new Error('Email mancante');
        await inviaEmail(cliente, destinatario, cliente.promemoria_oggetto, testo);
        stato = 'inviato';
        esito.email++;
      } catch (e) {
        stato = 'errore';
        errore = e.message;
        esito.errori++;
      }
    } else esito.whatsapp++;

    await pool.query(
      `INSERT INTO promemoria (chiave, persona_id, percorso_id, numero_rata, scadenza, canale, destinatario, testo, stato, errore, inviato_il)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $9 = 'inviato' THEN now() END)
       ON CONFLICT (chiave) DO UPDATE SET stato = EXCLUDED.stato, errore = EXCLUDED.errore, testo = EXCLUDED.testo,
         destinatario = EXCLUDED.destinatario, canale = EXCLUDED.canale, inviato_il = EXCLUDED.inviato_il`,
      [chiave, p.id, r.percorso_id || null, r.numero_rata || null, r.scadenza, canale, destinatario, testo, stato, errore]
    );
  }
  return esito;
}

async function controllaTutti() {
  const tot = { email: 0, whatsapp: 0, errori: 0 };
  for (const c of await db.listClienti()) {
    if (!c.promemoria_attivi) continue;
    try {
      const e = await controllaCliente(c);
      tot.email += e.email; tot.whatsapp += e.whatsapp; tot.errori += e.errori;
    } catch (err) {
      console.warn(`Promemoria ${c.nome}:`, err.message);
    }
  }
  return tot;
}

// ---- Elenco e azioni dall'interfaccia ------------------------------------------
async function elenco(clienteId) {
  const pool = await db.poolForCliente(clienteId);
  const { rows } = await pool.query(
    `SELECT pr.*, p.nome, p.cognome FROM promemoria pr JOIN persone p ON p.id = pr.persona_id
      ORDER BY (pr.stato = 'inviato'), pr.scadenza, pr.id DESC LIMIT 300`
  );
  return rows.map((r) => ({ ...r, link: r.canale === 'whatsapp' ? linkWhatsApp(r.destinatario, r.testo) : null }));
}

/** Tutti i WhatsApp ancora da inviare, per la Home. */
async function daInviareTutti() {
  const out = [];
  for (const c of await db.listClienti()) {
    if (!c.promemoria_attivi) continue;
    try {
      const pool = await db.poolForCliente(c.id);
      const { rows } = await pool.query(
        `SELECT pr.*, p.nome, p.cognome FROM promemoria pr JOIN persone p ON p.id = pr.persona_id
          WHERE pr.stato <> 'inviato' ORDER BY pr.scadenza`
      );
      rows.forEach((r) => out.push({ ...r, cliente_id: c.id, cliente_nome: c.nome, link: r.canale === 'whatsapp' ? linkWhatsApp(r.destinatario, r.testo) : null }));
    } catch { /* cliente non raggiungibile */ }
  }
  return out;
}

async function segnaInviato(clienteId, id) {
  const pool = await db.poolForCliente(clienteId);
  await pool.query("UPDATE promemoria SET stato = 'inviato', errore = NULL, inviato_il = now() WHERE id = $1", [id]);
  return true;
}

/** Riprova un'email andata in errore. */
async function riprova(clienteId, id) {
  const cliente = await db.getCliente(clienteId);
  const pool = await db.poolForCliente(clienteId);
  const { rows: [pr] } = await pool.query(
    'SELECT pr.*, p.email FROM promemoria pr JOIN persone p ON p.id = pr.persona_id WHERE pr.id = $1', [id]
  );
  if (!pr) throw new Error('Promemoria non trovato');
  try {
    await inviaEmail(cliente, pr.email, cliente.promemoria_oggetto, pr.testo);
    await pool.query("UPDATE promemoria SET stato = 'inviato', errore = NULL, destinatario = $2, inviato_il = now() WHERE id = $1", [id, pr.email]);
  } catch (e) {
    await pool.query("UPDATE promemoria SET stato = 'errore', errore = $2 WHERE id = $1", [id, e.message]);
    throw e;
  }
  return true;
}

async function eliminaPromemoria(clienteId, id) {
  const pool = await db.poolForCliente(clienteId);
  await pool.query('DELETE FROM promemoria WHERE id = $1', [id]);
  return true;
}

/** Email di prova all'indirizzo indicato, con le impostazioni SMTP passate. */
async function emailDiProva(smtp, a) {
  await inviaEmail({ smtp }, a, 'Prova invio promemoria', 'Se ricevi questo messaggio, l\'invio dei promemoria funziona.');
  return true;
}

module.exports = {
  TESTO_DEFAULT, OGGETTO_DEFAULT, GIORNI_PRIMA,
  dataInvio, componiTesto, numeroWhatsApp, linkWhatsApp,
  controllaCliente, controllaTutti, elenco, daInviareTutti, segnaInviato, riprova, eliminaPromemoria, emailDiProva
};
