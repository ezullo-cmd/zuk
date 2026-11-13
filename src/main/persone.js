// Anagrafica delle persone (i clienti dell'attività, es. gli allievi di un personal trainer):
// calcolo delle rate e dei ritardi, storico appuntamenti, ricevute e documenti PDF.
const db = require('./db');

// Mesi coperti da ogni tipo di pagamento. I tipi senza mesi non generano scadenze automatiche.
const FREQUENZE = {
  mensile: 1,
  bimestrale: 2,
  trimestrale: 3,
  quadrimestrale: 4,
  semestrale: 6,
  annuale: 12,
  pacchetto: 0, // pacchetto di lezioni: si paga quando si acquista
  a_lezione: 0
};

const MAX_FILE = 15 * 1024 * 1024;
const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];

// ---- Date (stringhe 'YYYY-MM-DD', senza fusi orari) -------------------------------
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const oggiISO = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
};
function addMonths(y, m, n) {
  const t = (y * 12 + (m - 1)) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

/**
 * Periodi di pagamento attesi per una persona, dall'inizio iscrizione fino a oggi
 * (o alla data di fine). Ogni periodo inizia il 1° del mese e la rata
 * scade l'ultimo giorno del primo mese del periodo
 * (mensile: la rata di novembre scade il 30 novembre).
 */
function periodiAttesi(persona, oggi = oggiISO()) {
  const mesi = FREQUENZE[persona.tipo_pagamento];
  if (!mesi || !persona.data_inizio) return [];
  const limite = persona.data_fine && persona.data_fine < oggi ? persona.data_fine : oggi;
  let [y, m] = persona.data_inizio.split('-').map(Number);
  const out = [];
  for (let i = 0; i < 600; i++) {
    const inizio = iso(y, m, 1);
    if (inizio > limite) break;
    const [fy, fm] = addMonths(y, m, mesi - 1);
    out.push({
      periodo: inizio,
      fino_al: iso(fy, fm, lastDay(fy, fm)),
      scadenza: iso(y, m, lastDay(y, m))
    });
    [y, m] = addMonths(y, m, mesi);
  }
  return out;
}

/** Unisce i periodi attesi con i pagamenti registrati e calcola lo stato di ogni rata. */
function situazioneRate(persona, pagamenti, oggi = oggiISO()) {
  const perPeriodo = new Map(pagamenti.filter((p) => p.periodo).map((p) => [p.periodo, p]));
  const rate = periodiAttesi(persona, oggi).map((r) => {
    const pag = perPeriodo.get(r.periodo);
    let stato;
    if (pag) stato = pag.esente ? 'esente' : 'pagata';
    else if (oggi > r.scadenza) stato = 'in_ritardo';
    else stato = 'da_pagare';
    return {
      ...r,
      stato,
      importo: pag ? pag.importo : persona.importo,
      pagamento: pag || null,
      ricevuta_mancante: !!pag && !pag.esente && !pag.documento_id
    };
  });
  // pagamenti registrati fuori dalle scadenze automatiche (pacchetti, lezioni singole, periodi passati)
  const attesi = new Set(rate.map((r) => r.periodo));
  const extra = pagamenti
    .filter((p) => !p.periodo || !attesi.has(p.periodo))
    .map((p) => ({
      periodo: p.periodo, fino_al: null, scadenza: null, stato: p.esente ? 'esente' : 'pagata',
      importo: p.importo, pagamento: p, ricevuta_mancante: !p.esente && !p.documento_id
    }));
  const tutte = [...rate, ...extra].sort((a, b) =>
    String(b.periodo || b.pagamento?.pagato_il).localeCompare(String(a.periodo || a.pagamento?.pagato_il))
  );
  const inRitardo = rate.filter((r) => r.stato === 'in_ritardo');
  const daPagare = rate.find((r) => r.stato === 'da_pagare');
  return {
    rate: tutte,
    inRitardo: inRitardo.map((r) => ({ periodo: r.periodo, scadenza: r.scadenza, importo: r.importo })),
    importoInRitardo: inRitardo.reduce((s, r) => s + (Number(r.importo) || 0), 0),
    prossimaScadenza: daPagare ? daPagare.scadenza : null,
    ricevuteMancanti: rate.filter((r) => r.ricevuta_mancante).length
  };
}

/** Statistiche sulla frequenza degli appuntamenti. */
function statisticheAppuntamenti(appuntamenti, now = new Date()) {
  const passati = appuntamenti.filter((a) => new Date(a.inizio) <= now);
  const futuri = appuntamenti
    .filter((a) => new Date(a.inizio) > now && a.stato === 'programmato')
    .sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  // un appuntamento passato ancora "programmato" viene considerato svolto
  const svolti = passati
    .filter((a) => a.stato === 'svolto' || a.stato === 'programmato')
    .sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  const giorni = (ms) => ms / 86400000;
  let mediaGiorni = null;
  if (svolti.length > 1) {
    const span = giorni(new Date(svolti[svolti.length - 1].inizio) - new Date(svolti[0].inizio));
    mediaGiorni = Math.round((span / (svolti.length - 1)) * 10) / 10;
  }
  const ultime4 = svolti.filter((a) => giorni(now - new Date(a.inizio)) <= 28).length;
  const ultimo = svolti[svolti.length - 1] || null;
  return {
    svolti: svolti.length,
    assenze: passati.filter((a) => a.stato === 'assente').length,
    annullati: appuntamenti.filter((a) => a.stato === 'annullato').length,
    programmati: futuri.length,
    primo: svolti[0]?.inizio || null,
    ultimo: ultimo?.inizio || null,
    giorniDallUltimo: ultimo ? Math.floor(giorni(now - new Date(ultimo.inizio))) : null,
    prossimo: futuri[0]?.inizio || null,
    mediaGiorni,
    perSettimana: Math.round((ultime4 / 4) * 10) / 10
  };
}

const PAG_COLS = 'id, persona_id, periodo, importo, pagato_il, metodo, esente, documento_id, note';
const DOC_COLS = 'id, persona_id, nome_file, mime, dimensione, descrizione, caricato_il';

// ---- Lettura -----------------------------------------------------------------------

async function listPersone(clienteId) {
  const pool = await db.poolForCliente(clienteId);
  const [persone, pagamenti, app] = await Promise.all([
    pool.query('SELECT * FROM persone ORDER BY cognome, nome'),
    pool.query(`SELECT ${PAG_COLS} FROM pagamenti`),
    pool.query(`SELECT persona_id,
                       max(inizio) FILTER (WHERE inizio <= now() AND stato IN ('svolto','programmato')) AS ultimo,
                       min(inizio) FILTER (WHERE inizio > now() AND stato = 'programmato') AS prossimo
                  FROM appuntamenti WHERE persona_id IS NOT NULL GROUP BY persona_id`)
  ]);
  const oggi = oggiISO();
  const appMap = new Map(app.rows.map((r) => [r.persona_id, r]));
  return persone.rows.map((p) => {
    const s = situazioneRate(p, pagamenti.rows.filter((x) => x.persona_id === p.id), oggi);
    delete s.rate;
    return {
      ...p,
      situazione: {
        ...s,
        certificatoScaduto: !!p.certificato_scadenza && p.certificato_scadenza < oggi,
        ultimoAppuntamento: appMap.get(p.id)?.ultimo || null,
        prossimoAppuntamento: appMap.get(p.id)?.prossimo || null
      }
    };
  });
}

async function dettaglioPersona(clienteId, personaId) {
  const pool = await db.poolForCliente(clienteId);
  const [p, pagamenti, documenti, appuntamenti] = await Promise.all([
    pool.query('SELECT * FROM persone WHERE id = $1', [personaId]),
    pool.query(`SELECT ${PAG_COLS} FROM pagamenti WHERE persona_id = $1`, [personaId]),
    pool.query(`SELECT ${DOC_COLS} FROM documenti WHERE persona_id = $1 ORDER BY caricato_il DESC`, [personaId]),
    pool.query('SELECT * FROM appuntamenti WHERE persona_id = $1 ORDER BY inizio DESC', [personaId])
  ]);
  if (!p.rows.length) throw new Error('Persona non trovata');
  const persona = p.rows[0];
  const oggi = oggiISO();
  return {
    persona,
    pagamenti: situazioneRate(persona, pagamenti.rows, oggi),
    certificatoScaduto: !!persona.certificato_scadenza && persona.certificato_scadenza < oggi,
    documenti: documenti.rows,
    appuntamenti: appuntamenti.rows,
    statistiche: statisticheAppuntamenti(appuntamenti.rows)
  };
}

// ---- Scrittura -----------------------------------------------------------------------

function checkFile(file) {
  if (!file) return null;
  const buf = Buffer.from(file.data);
  if (!buf.length) throw new Error('Il file è vuoto');
  if (buf.length > MAX_FILE) throw new Error('Il file supera i 15 MB');
  if (!MIME_OK.includes(file.mime)) throw new Error('Formato non supportato: carica un PDF o un\'immagine');
  return { nome: String(file.name || 'documento').slice(0, 200), mime: file.mime, buf };
}

async function inserisciDocumento(client, personaId, file, descrizione) {
  const { rows } = await client.query(
    `INSERT INTO documenti (persona_id, nome_file, mime, dimensione, dati, descrizione)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${DOC_COLS}`,
    [personaId, file.nome, file.mime, file.buf.length, file.buf, descrizione || null]
  );
  return rows[0];
}

/** Registra (o aggiorna) il pagamento di una rata, con ricevuta opzionale. */
async function salvaPagamento(clienteId, data, file) {
  const f = checkFile(file);
  const pool = await db.poolForCliente(clienteId);
  const c = await pool.connect();
  const v = (x) => (x === '' || x === undefined ? null : x);
  try {
    await c.query('BEGIN');
    let documentoId = v(data.documento_id);
    if (f) {
      const descr = data.periodo ? `Ricevuta rata ${data.periodo.slice(0, 7)}` : 'Ricevuta pagamento';
      documentoId = (await inserisciDocumento(c, data.persona_id, f, descr)).id;
    }
    const vals = [
      data.persona_id, v(data.periodo), v(data.importo), v(data.pagato_il) || oggiISO(),
      v(data.metodo), !!data.esente, documentoId, v(data.note)
    ];
    let row;
    if (data.id) {
      ({ rows: [row] } = await c.query(
        `UPDATE pagamenti SET persona_id=$1, periodo=$2, importo=$3, pagato_il=$4, metodo=$5, esente=$6,
                documento_id=$7, note=$8 WHERE id=$9 RETURNING ${PAG_COLS}`,
        [...vals, data.id]
      ));
    } else {
      ({ rows: [row] } = await c.query(
        `INSERT INTO pagamenti (persona_id, periodo, importo, pagato_il, metodo, esente, documento_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${PAG_COLS}`,
        vals
      ));
    }
    await c.query('COMMIT');
    return row;
  } catch (e) {
    await c.query('ROLLBACK');
    if (e.code === '23505') throw new Error('Questa rata risulta già registrata');
    throw e;
  } finally {
    c.release();
  }
}

async function caricaDocumento(clienteId, personaId, file, descrizione) {
  const f = checkFile(file);
  if (!f) throw new Error('Nessun file selezionato');
  const pool = await db.poolForCliente(clienteId);
  return inserisciDocumento(pool, personaId, f, descrizione);
}

async function leggiDocumento(clienteId, documentoId) {
  const pool = await db.poolForCliente(clienteId);
  const { rows } = await pool.query('SELECT nome_file, mime, dati FROM documenti WHERE id = $1', [documentoId]);
  if (!rows.length) throw new Error('Documento non trovato');
  return rows[0];
}

async function eliminaDocumento(clienteId, documentoId) {
  const pool = await db.poolForCliente(clienteId);
  await pool.query('DELETE FROM documenti WHERE id = $1', [documentoId]);
  return true;
}

async function salvaPersona(clienteId, id, data) {
  // chi viene segnato come "cessato" smette di generare rate da oggi
  if (data.stato === 'cessato' && !data.data_fine) data = { ...data, data_fine: oggiISO() };
  if (data.tipo_pagamento && !(data.tipo_pagamento in FREQUENZE)) throw new Error('Tipo di pagamento non valido');
  return id ? db.update(clienteId, 'persone', id, data) : db.create(clienteId, 'persone', data);
}

module.exports = {
  FREQUENZE, periodiAttesi, situazioneRate, statisticheAppuntamenti,
  listPersone, dettaglioPersona, salvaPersona, salvaPagamento,
  caricaDocumento, leggiDocumento, eliminaDocumento
};
