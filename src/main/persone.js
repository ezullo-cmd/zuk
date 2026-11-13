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
    inRitardo: inRitardo.map((r) => ({ periodo: r.periodo, scadenza: r.scadenza, importo: r.importo, etichetta: null })),
    importoInRitardo: inRitardo.reduce((s, r) => s + (Number(r.importo) || 0), 0),
    prossimaScadenza: daPagare ? daPagare.scadenza : null,
    ricevuteMancanti: rate.filter((r) => r.ricevuta_mancante).length
  };
}

// ---- Percorsi (personal trainer / nutrizione) ----------------------------------------
const TIPI_PERCORSO = ['personal', 'nutrizione', 'personal_nutrizione'];
const MODALITA = ['unica', 'rate'];

const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUTC = (d) => iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

/** Ultimo giorno del percorso: inizio + durata in mesi - 1 giorno (1/11 + 3 mesi -> 31/1). */
function finePercorso(p) {
  const [y, m, d] = p.data_inizio.split('-').map(Number);
  const [y2, m2] = addMonths(y, m, p.durata_mesi);
  if (d > lastDay(y2, m2)) return iso(y2, m2, lastDay(y2, m2)); // es. 31/1 + 1 mese -> 28/2
  const fine = toUTC(iso(y2, m2, d));
  fine.setUTCDate(fine.getUTCDate() - 1);
  return fromUTC(fine);
}

/**
 * Piano rate di un percorso. L'importo totale viene diviso in parti uguali
 * (l'ultima rata assorbe gli arrotondamenti). Le rate sono distribuite lungo la durata
 * (6 mesi in 3 rate = una ogni 2 mesi) e ognuna scade a fine mese:
 * la 1ª a fine del mese di inizio, la 2ª a fine del mese successivo all'intervallo, ecc.
 */
function pianoRate(p) {
  const n = p.modalita === 'rate' ? Math.max(1, p.numero_rate) : 1;
  const totale = Number(p.importo_totale) || 0;
  const base = Math.floor((totale / n) * 100) / 100;
  const passo = Math.max(1, Math.floor(p.durata_mesi / n));
  const [y, m] = p.data_inizio.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const [ry, rm] = addMonths(y, m, i * passo);
    return {
      numero_rata: i + 1,
      di: n,
      scadenza: iso(ry, rm, lastDay(ry, rm)),
      importo: p.importo_totale === null || p.importo_totale === undefined
        ? null
        : i === n - 1 ? Math.round((totale - base * (n - 1)) * 100) / 100 : base
    };
  });
}

function situazionePercorso(p, pagamenti, oggi = oggiISO()) {
  const pag = new Map(pagamenti.filter((x) => x.percorso_id === p.id).map((x) => [x.numero_rata, x]));
  const fine = finePercorso(p);
  const rate = pianoRate(p).map((r) => {
    const pg = pag.get(r.numero_rata);
    let stato;
    if (pg) stato = pg.esente ? 'esente' : 'pagata';
    else if (oggi > r.scadenza) stato = 'in_ritardo';
    else stato = 'da_pagare';
    return {
      ...r,
      percorso_id: p.id,
      periodo: null,
      etichetta: r.di === 1 ? 'Unica soluzione' : `Rata ${r.numero_rata} di ${r.di}`,
      stato,
      importo: pg ? pg.importo : r.importo,
      pagamento: pg || null,
      ricevuta_mancante: !!pg && !pg.esente && !pg.documento_id
    };
  });
  const giorniAllaFine = Math.round((toUTC(fine) - toUTC(oggi)) / 86400000);
  const statoPercorso = oggi < p.data_inizio ? 'futuro' : oggi > fine ? 'concluso' : 'in_corso';
  return {
    ...p, fine, rate, stato: statoPercorso, giorniAllaFine,
    pagato: rate.filter((r) => r.stato === 'pagata').reduce((s, r) => s + (Number(r.importo) || 0), 0)
  };
}

/** Riepilogo di persona: percorsi + eventuale abbonamento ricorrente (vecchio modello). */
function situazioneCompleta(persona, percorsi, pagamenti, oggi = oggiISO()) {
  const perc = percorsi
    .filter((p) => p.persona_id === persona.id)
    .map((p) => situazionePercorso(p, pagamenti, oggi))
    .sort((a, b) => b.data_inizio.localeCompare(a.data_inizio));
  const legacy = situazioneRate(persona, pagamenti.filter((x) => !x.percorso_id), oggi);
  const ratePerc = perc.flatMap((p) => p.rate.map((r) => ({ ...r, tipo_percorso: p.tipo })));
  const ritardoPerc = ratePerc.filter((r) => r.stato === 'in_ritardo')
    .map((r) => ({ periodo: null, scadenza: r.scadenza, importo: r.importo, etichetta: r.etichetta }));
  const inRitardo = [...ritardoPerc, ...legacy.inRitardo];
  const scadenze = [
    ...ratePerc.filter((r) => r.stato === 'da_pagare').map((r) => r.scadenza),
    legacy.prossimaScadenza
  ].filter(Boolean).sort();
  const attuale = perc.find((p) => p.stato === 'in_corso') || perc.find((p) => p.stato === 'futuro') || perc[0] || null;
  // stato complessivo della persona rispetto ai percorsi
  const haFuturo = perc.some((p) => p.stato === 'futuro');
  const inCorso = perc.find((p) => p.stato === 'in_corso');
  const abbonamentoAttivo = FREQUENZE[persona.tipo_pagamento] > 0 && (!persona.data_fine || persona.data_fine >= oggi);
  let statoPercorso;
  if (persona.stato === 'cessato') statoPercorso = 'terminato';
  else if (inCorso || haFuturo || abbonamentoAttivo) statoPercorso = 'attivo';
  else if (perc.length) statoPercorso = 'terminato';
  else statoPercorso = 'nessuno';
  const daRinnovare = statoPercorso === 'attivo' && !!inCorso && !haFuturo && inCorso.giorniAllaFine <= 30;
  return {
    percorsi: perc,
    legacy,
    inRitardo,
    importoInRitardo: inRitardo.reduce((s, r) => s + (Number(r.importo) || 0), 0),
    prossimaScadenza: scadenze[0] || null,
    ricevuteMancanti: ratePerc.filter((r) => r.ricevuta_mancante).length + legacy.ricevuteMancanti,
    percorsoAttuale: attuale && {
      id: attuale.id, tipo: attuale.tipo, fine: attuale.fine, stato: attuale.stato, giorniAllaFine: attuale.giorniAllaFine
    },
    statoPercorso,
    daRinnovare,
    numPercorsi: perc.length,
    numRinnovi: perc.filter((p) => p.rinnovo_di).length,
    ultimaFine: perc.length ? perc.map((p) => p.fine).sort().pop() : null
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

const PAG_COLS = 'id, persona_id, periodo, importo, pagato_il, metodo, esente, documento_id, note, percorso_id, numero_rata';
const DOC_COLS = 'id, persona_id, nome_file, mime, dimensione, descrizione, caricato_il';

// ---- Lettura -----------------------------------------------------------------------

async function listPersone(clienteId) {
  const pool = await db.poolForCliente(clienteId);
  const [persone, pagamenti, app, percorsi] = await Promise.all([
    pool.query('SELECT * FROM persone ORDER BY cognome, nome'),
    pool.query(`SELECT ${PAG_COLS} FROM pagamenti`),
    pool.query(`SELECT persona_id,
                       max(inizio) FILTER (WHERE inizio <= now() AND stato IN ('svolto','programmato')) AS ultimo,
                       min(inizio) FILTER (WHERE inizio > now() AND stato = 'programmato') AS prossimo
                  FROM appuntamenti WHERE persona_id IS NOT NULL GROUP BY persona_id`),
    pool.query('SELECT * FROM percorsi')
  ]);
  const oggi = oggiISO();
  const appMap = new Map(app.rows.map((r) => [r.persona_id, r]));
  return persone.rows.map((p) => {
    const s = situazioneCompleta(p, percorsi.rows, pagamenti.rows.filter((x) => x.persona_id === p.id), oggi);
    delete s.percorsi;
    delete s.legacy;
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

/** Tutte le rate di tutte le persone (per la sezione "Pagamenti e rate"). */
async function listRate(clienteId) {
  const pool = await db.poolForCliente(clienteId);
  const [persone, pagamenti, percorsi] = await Promise.all([
    pool.query('SELECT * FROM persone ORDER BY cognome, nome'),
    pool.query(`SELECT ${PAG_COLS} FROM pagamenti`),
    pool.query('SELECT * FROM percorsi')
  ]);
  const oggi = oggiISO();
  const rate = [];
  for (const p of persone.rows) {
    const s = situazioneCompleta(p, percorsi.rows, pagamenti.rows.filter((x) => x.persona_id === p.id), oggi);
    const persona = { id: p.id, nome: p.nome, cognome: p.cognome, stato: p.stato, importo: p.importo, metodo_pagamento: p.metodo_pagamento };
    for (const pc of s.percorsi)
      for (const r of pc.rate) rate.push({ ...r, persona, tipo_percorso: pc.tipo, percorso_fine: pc.fine });
    for (const r of s.legacy.rate) rate.push({ ...r, persona, tipo_percorso: null });
  }
  return { oggi, rate };
}

async function dettaglioPersona(clienteId, personaId) {
  const pool = await db.poolForCliente(clienteId);
  const [p, pagamenti, documenti, appuntamenti, percorsi] = await Promise.all([
    pool.query('SELECT * FROM persone WHERE id = $1', [personaId]),
    pool.query(`SELECT ${PAG_COLS} FROM pagamenti WHERE persona_id = $1`, [personaId]),
    pool.query(`SELECT ${DOC_COLS} FROM documenti WHERE persona_id = $1 ORDER BY caricato_il DESC`, [personaId]),
    pool.query('SELECT * FROM appuntamenti WHERE persona_id = $1 ORDER BY inizio DESC', [personaId]),
    pool.query('SELECT * FROM percorsi WHERE persona_id = $1', [personaId])
  ]);
  if (!p.rows.length) throw new Error('Persona non trovata');
  const persona = p.rows[0];
  const oggi = oggiISO();
  return {
    persona,
    situazione: situazioneCompleta(persona, percorsi.rows, pagamenti.rows, oggi),
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
      const descr = data.descrizione_ricevuta || (data.periodo ? `Contabile rata ${data.periodo.slice(0, 7)}` : 'Contabile pagamento');
      documentoId = (await inserisciDocumento(c, data.persona_id, f, descr)).id;
    }
    const vals = [
      data.persona_id, v(data.periodo), v(data.importo), v(data.pagato_il) || oggiISO(),
      v(data.metodo), !!data.esente, documentoId, v(data.note), v(data.percorso_id), v(data.numero_rata)
    ];
    let row;
    if (data.id) {
      ({ rows: [row] } = await c.query(
        `UPDATE pagamenti SET persona_id=$1, periodo=$2, importo=$3, pagato_il=$4, metodo=$5, esente=$6,
                documento_id=$7, note=$8, percorso_id=$9, numero_rata=$10 WHERE id=$11 RETURNING ${PAG_COLS}`,
        [...vals, data.id]
      ));
    } else {
      ({ rows: [row] } = await c.query(
        `INSERT INTO pagamenti (persona_id, periodo, importo, pagato_il, metodo, esente, documento_id, note, percorso_id, numero_rata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${PAG_COLS}`,
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
  const { percorso, ...dati } = data;
  // chi viene segnato come "cessato" smette di generare rate da oggi (abbonamenti ricorrenti)
  if (dati.stato === 'cessato' && !dati.data_fine) dati.data_fine = oggiISO();
  if (dati.tipo_pagamento && dati.tipo_pagamento !== 'percorso' && !(dati.tipo_pagamento in FREQUENZE))
    throw new Error('Tipo di pagamento non valido');
  if (!id && !dati.tipo_pagamento) dati.tipo_pagamento = 'percorso';
  await validaCanale(clienteId, id, dati);
  if (!id && percorso && !dati.data_inizio) dati.data_inizio = percorso.data_inizio;
  if (percorso) validaPercorso(percorso);
  const saved = id ? await db.update(clienteId, 'persone', id, dati) : await db.create(clienteId, 'persone', dati);
  if (percorso) await salvaPercorso(clienteId, null, { ...percorso, persona_id: saved.id });
  return saved;
}

// Il canale scelto per le comunicazioni deve avere il recapito compilato
async function validaCanale(clienteId, id, dati) {
  let attuale = {};
  if (id) {
    const pool = await db.poolForCliente(clienteId);
    attuale = (await pool.query('SELECT telefono, email, canale_comunicazione FROM persone WHERE id = $1', [id])).rows[0] || {};
  }
  const v = { ...attuale, ...dati };
  if (!id && !v.canale_comunicazione) throw new Error('Scegli se inviare le comunicazioni via telefono o via email');
  if (v.canale_comunicazione && !['telefono', 'email'].includes(v.canale_comunicazione)) throw new Error('Canale non valido');
  if (v.canale_comunicazione === 'telefono' && !String(v.telefono || '').trim())
    throw new Error('Hai scelto le comunicazioni via telefono: inserisci il numero di telefono');
  if (v.canale_comunicazione === 'email') {
    if (!String(v.email || '').trim()) throw new Error('Hai scelto le comunicazioni via email: inserisci l\'indirizzo email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) throw new Error('L\'indirizzo email non è valido');
  }
}

function validaPercorso(d) {
  if (!TIPI_PERCORSO.includes(d.tipo)) throw new Error('Tipo di percorso non valido');
  if (!MODALITA.includes(d.modalita)) throw new Error('Modalità di pagamento non valida');
  if (!d.data_inizio) throw new Error('Indica la data di inizio del percorso');
  if (!(Number(d.durata_mesi) > 0)) throw new Error('Indica la durata del percorso');
  const n = d.modalita === 'rate' ? Number(d.numero_rate) : 1;
  if (!(n >= 1 && n <= 36)) throw new Error('Numero di rate non valido');
  const out = { ...d, durata_mesi: Number(d.durata_mesi), numero_rate: n };
  if (!out.rinnovo_di) delete out.rinnovo_di; // in modifica non si tocca il collegamento al percorso precedente
  return out;
}

async function salvaPercorso(clienteId, id, data) {
  const d = validaPercorso(data);
  if (id) {
    // se il numero di rate diminuisce, i pagamenti delle rate che non esistono più vanno rimossi a mano
    const pool = await db.poolForCliente(clienteId);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM pagamenti WHERE percorso_id = $1 AND numero_rata > $2', [id, d.numero_rate]
    );
    if (rows[0].n) throw new Error('Ci sono pagamenti registrati su rate che verrebbero eliminate: annullali prima di ridurre le rate');
    return db.update(clienteId, 'percorsi', id, d);
  }
  return db.create(clienteId, 'percorsi', d);
}

module.exports = {
  FREQUENZE, periodiAttesi, situazioneRate, statisticheAppuntamenti,
  finePercorso, pianoRate, situazionePercorso,
  listPersone, listRate, dettaglioPersona, salvaPersona, salvaPercorso, salvaPagamento,
  caricaDocumento, leggiDocumento, eliminaDocumento
};
