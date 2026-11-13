// Promemoria delle rate in scadenza.
// 5 giorni lavorativi prima della scadenza di una rata non pagata, dall'orario impostato (12:00):
// - canale "email": invio automatico dalla casella configurata nelle Impostazioni;
// - canale "telefono": invio automatico su WhatsApp, solo se WhatsApp Web è connesso
//   (altrimenti il messaggio resta in attesa e parte appena ci si collega).
const nodemailer = require('nodemailer');
const db = require('./db');
const persone = require('./persone');
const { giorniLavorativiPrima } = require('../../portal/lib/calendario');

const GIORNI_PRIMA = 5;
const TESTO_DEFAULT =
  'Salve <nome>, le ricordiamo che in data <data di scadenza> scadrà la prossima rata del percorso <tipo percorso>.';
const OGGETTO_DEFAULT = 'Promemoria scadenza rata';
const { nomePercorso } = require('../../portal/lib/calcoli');

// ---- Data di invio: N giorni lavorativi prima della scadenza ----------------------
const pad = (n) => String(n).padStart(2, '0');
const dataInvio = (scadenza, giorni = GIORNI_PRIMA) => giorniLavorativiPrima(scadenza, giorni);

// ---- Testo -------------------------------------------------------------------
const dataIT = (iso) => iso.split('-').reverse().join('/');
const euro = (n) => (n === null || n === undefined ? '' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n));

function componiTesto(modello, persona, rata) {
  const valori = {
    nome: persona.nome,
    cognome: persona.cognome,
    'data di scadenza': dataIT(rata.scadenza),
    'tipo percorso': nomePercorso(rata.tipo_percorso) || 'in corso',
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

// ---- Email (casella unica configurata nelle Impostazioni) -------------------------
let getEmailConfig = () => ({});
let whatsapp = null;
let getOrario = () => '12:00';

/** Collega le dipendenze del processo principale (configurazione e WhatsApp). */
function configura(opts) {
  if (opts.emailConfig) getEmailConfig = opts.emailConfig;
  if (opts.whatsapp) whatsapp = opts.whatsapp;
  if (opts.orario) getOrario = opts.orario;
}

function trasporto(cfg) {
  if (!cfg?.user || !cfg?.password) throw new Error('Casella email non configurata (Impostazioni → Email per i promemoria)');
  return nodemailer.createTransport({
    host: cfg.host || 'smtp.gmail.com',
    port: Number(cfg.port) || 465,
    secure: cfg.secure !== false,
    auth: { user: cfg.user, pass: cfg.password }
  });
}

async function inviaEmail(cliente, a, oggetto, testo, cfg = getEmailConfig()) {
  const nome = (cliente.promemoria_mittente || cliente.nome || '').replace(/"/g, '');
  await trasporto(cfg).sendMail({
    from: nome ? `"${nome}" <${cfg.user}>` : cfg.user,
    replyTo: cliente.email || undefined,
    to: a,
    subject: oggetto || OGGETTO_DEFAULT,
    text: testo
  });
}

// ---- Controllo periodico -------------------------------------------------------
const oggiISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const oraHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** È arrivato l'orario di invio di oggi? */
const orarioRaggiunto = (ora = oraHHMM()) => ora >= (getOrario() || '12:00');

/**
 * 1) per ogni rata non pagata la cui data di invio è arrivata (e non ancora scaduta)
 *    crea il promemoria una sola volta;
 * 2) invia quelli in attesa: email tramite la casella configurata, WhatsApp solo se connesso.
 * Tutto parte solo dopo l'orario impostato (predefinito 12:00).
 */
async function controllaCliente(cliente, oggi = oggiISO(), ora = oraHHMM()) {
  const esito = { email: 0, whatsapp: 0, inAttesa: 0, errori: 0 };
  if (!cliente.promemoria_attivi || !orarioRaggiunto(ora)) return esito;
  const pool = await db.poolForCliente(cliente.id);
  const [{ rate }, anagrafica, esistenti] = await Promise.all([
    persone.listRate(cliente.id),
    pool.query('SELECT id, nome, cognome, telefono, email, canale_comunicazione, stato FROM persone'),
    pool.query('SELECT chiave FROM promemoria')
  ]);
  const pers = new Map(anagrafica.rows.map((p) => [p.id, p]));
  const giaCreati = new Set(esistenti.rows.map((r) => r.chiave));

  // 1) nuovi promemoria
  for (const r of rate) {
    if (r.stato !== 'da_pagare' || !r.scadenza) continue;
    if (oggi < dataInvio(r.scadenza) || oggi > r.scadenza) continue;
    const p = pers.get(r.persona.id);
    if (!p || p.stato === 'cessato' || !p.canale_comunicazione) continue;
    const chiave = r.percorso_id ? `perc-${r.percorso_id}-${r.numero_rata}` : `abb-${p.id}-${r.periodo}`;
    if (giaCreati.has(chiave)) continue;
    await pool.query(
      `INSERT INTO promemoria (chiave, persona_id, percorso_id, numero_rata, scadenza, canale, destinatario, testo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (chiave) DO NOTHING`,
      [chiave, p.id, r.percorso_id || null, r.numero_rata || null, r.scadenza,
        p.canale_comunicazione === 'email' ? 'email' : 'whatsapp',
        p.canale_comunicazione === 'email' ? p.email : p.telefono, componiTesto(cliente.promemoria_testo, p, r)]
    );
  }

  // 2) invio di quelli in attesa (gli errori si ritentano al massimo una volta l'ora)
  const { rows: coda } = await pool.query(
    `SELECT pr.*, p.telefono, p.email, p.canale_comunicazione, p.stato AS stato_persona
       FROM promemoria pr JOIN persone p ON p.id = pr.persona_id
      WHERE pr.stato IN ('da_inviare', 'errore') AND pr.scadenza >= $1
        AND (pr.stato = 'da_inviare' OR pr.ultimo_tentativo IS NULL OR pr.ultimo_tentativo < now() - interval '1 hour')
      ORDER BY pr.scadenza, pr.id`,
    [oggi]
  );
  for (const pr of coda) {
    if (pr.stato_persona === 'cessato') continue;
    // si usa il canale e il recapito attuali della persona (possono essere cambiati)
    const canale = pr.canale_comunicazione === 'email' ? 'email' : 'whatsapp';
    const destinatario = canale === 'email' ? pr.email : pr.telefono;
    if (canale === 'whatsapp' && !whatsapp?.connesso()) {
      esito.inAttesa++;
      await pool.query('UPDATE promemoria SET canale = $2, destinatario = $3 WHERE id = $1', [pr.id, canale, destinatario]);
      continue;
    }
    try {
      if (!destinatario) throw new Error(canale === 'email' ? 'Email mancante' : 'Numero di telefono mancante');
      if (canale === 'email') {
        await inviaEmail(cliente, destinatario, cliente.promemoria_oggetto, pr.testo);
        esito.email++;
      } else {
        const n = numeroWhatsApp(destinatario);
        if (!n) throw new Error('Numero di telefono non valido');
        await whatsapp.invia(n, pr.testo);
        esito.whatsapp++;
      }
      await pool.query(
        `UPDATE promemoria SET stato = 'inviato', errore = NULL, canale = $2, destinatario = $3,
                inviato_il = now(), ultimo_tentativo = now() WHERE id = $1`,
        [pr.id, canale, destinatario]
      );
    } catch (e) {
      esito.errori++;
      await pool.query(
        `UPDATE promemoria SET stato = 'errore', errore = $2, canale = $3, destinatario = $4, ultimo_tentativo = now() WHERE id = $1`,
        [pr.id, e.message, canale, destinatario]
      );
    }
  }
  return esito;
}

async function controllaTutti() {
  const tot = { email: 0, whatsapp: 0, inAttesa: 0, errori: 0 };
  for (const c of await db.listClienti()) {
    if (!c.promemoria_attivi) continue;
    try {
      const e = await controllaCliente(c);
      for (const k of Object.keys(tot)) tot[k] += e[k];
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
  return rows;
}

/** Promemoria non ancora inviati di tutti i clienti, per la Home. */
async function daInviareTutti() {
  const out = [];
  for (const c of await db.listClienti()) {
    if (!c.promemoria_attivi) continue;
    try {
      const pool = await db.poolForCliente(c.id);
      const { rows } = await pool.query(
        `SELECT pr.*, p.nome, p.cognome FROM promemoria pr JOIN persone p ON p.id = pr.persona_id
          WHERE pr.stato <> 'inviato' AND pr.scadenza >= CURRENT_DATE ORDER BY pr.scadenza`
      );
      rows.forEach((r) => out.push({ ...r, cliente_id: c.id, cliente_nome: c.nome }));
    } catch { /* cliente non raggiungibile */ }
  }
  return out;
}

async function segnaInviato(clienteId, id) {
  const pool = await db.poolForCliente(clienteId);
  await pool.query("UPDATE promemoria SET stato = 'inviato', errore = NULL, inviato_il = now() WHERE id = $1", [id]);
  return true;
}

/** Rimette in coda un promemoria (verrà inviato al prossimo controllo). */
async function rimettiInCoda(clienteId, id) {
  const pool = await db.poolForCliente(clienteId);
  await pool.query("UPDATE promemoria SET stato = 'da_inviare', errore = NULL, ultimo_tentativo = NULL WHERE id = $1", [id]);
  return true;
}

/** Email di prova con le impostazioni indicate (o quelle salvate). */
async function emailDiProva(cfg, a) {
  await inviaEmail({ nome: 'Zuk Gestionale' }, a, 'Prova invio promemoria',
    'Se ricevi questo messaggio, l\'invio dei promemoria via email funziona.', cfg);
  return true;
}

module.exports = {
  TESTO_DEFAULT, OGGETTO_DEFAULT, GIORNI_PRIMA,
  configura, dataInvio, componiTesto, numeroWhatsApp, linkWhatsApp, orarioRaggiunto,
  controllaCliente, controllaTutti, elenco, daInviareTutti, segnaInviato, rimettiInCoda, emailDiProva
};
