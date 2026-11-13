// Anagrafica delle persone (i clienti dell'attività, es. gli allievi di un personal trainer):
// calcolo delle rate e dei ritardi, storico appuntamenti, ricevute e documenti PDF.
const db = require('./db');
const {
  FREQUENZE, TIPI_PERCORSO, NOMI_PERCORSO, MODALITA, oggiISO, periodiAttesi, situazioneRate, finePercorso,
  primaScadenzaPredefinita, pianoRate, situazionePercorso, situazioneCompleta, statisticheAppuntamenti,
  riepilogoPersone, tutteLeRate
} = require('../../portal/lib/calcoli');


const MAX_FILE = 15 * 1024 * 1024;
const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];


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
  return riepilogoPersone(persone.rows, percorsi.rows, pagamenti.rows, app.rows, oggiISO());
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
  const rate = tutteLeRate(persone.rows, percorsi.rows, pagamenti.rows, oggi);
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

/** Tipo di percorso: uno di base oppure un testo libero (max 60 caratteri). */
function normalizzaTipo(tipo) {
  const t = String(tipo || '').trim().replace(/\s+/g, ' ');
  if (!t) throw new Error('Indica il tipo di percorso');
  if (TIPI_PERCORSO.includes(t)) return t;
  if (t.length > 60) throw new Error('Il tipo di percorso può avere al massimo 60 caratteri');
  // se coincide con un tipo di base (es. "allenamento") si usa quello
  const base = Object.entries(NOMI_PERCORSO).find(([, nome]) => nome.toLowerCase() === t.toLowerCase());
  return base ? base[0] : t;
}

/** Tipi scritti a mano per questo cliente (da mostrare tra quelli selezionabili). */
async function tipiPercorso(clienteId) {
  const pool = await db.poolForCliente(clienteId);
  const { rows } = await pool.query(
    `SELECT nome FROM tipi_percorso
      UNION SELECT DISTINCT tipo FROM percorsi WHERE NOT (tipo = ANY($1))
      ORDER BY 1`, [TIPI_PERCORSO]
  );
  return rows.map((r) => r.nome);
}

async function rimuoviTipoPercorso(clienteId, nome) {
  const pool = await db.poolForCliente(clienteId);
  await pool.query('DELETE FROM tipi_percorso WHERE nome = $1', [nome]);
  return true;
}

function validaPercorso(d) {
  d = { ...d, tipo: normalizzaTipo(d.tipo) };
  if (!MODALITA.includes(d.modalita)) throw new Error('Modalità di pagamento non valida');
  if (!d.data_inizio) throw new Error('Indica la data di inizio del percorso');
  if (!(Number(d.durata_mesi) > 0)) throw new Error('Indica la durata del percorso');
  const n = d.modalita === 'rate' ? Number(d.numero_rate) : 1;
  if (!(n >= 1 && n <= 36)) throw new Error('Numero di rate non valido');
  const out = { ...d, durata_mesi: Number(d.durata_mesi), numero_rate: n };
  // prima scadenza uguale a quella predefinita = regola "ultimo giorno lavorativo del mese"
  if (!out.prima_scadenza || out.prima_scadenza === primaScadenzaPredefinita(out)) out.prima_scadenza = null;
  if (!out.rinnovo_di) delete out.rinnovo_di; // in modifica non si tocca il collegamento al percorso precedente
  return out;
}

/** Anteprima per il modulo: scadenze, importi e fine del percorso. */
function anteprimaPercorso(data) {
  if (!data?.data_inizio || !(Number(data.durata_mesi) > 0)) return null;
  const p = {
    ...data, durata_mesi: Number(data.durata_mesi),
    numero_rate: data.modalita === 'rate' ? Number(data.numero_rate) || 1 : 1,
    importo_totale: data.importo_totale === '' || data.importo_totale === undefined ? null : Number(data.importo_totale)
  };
  return { fine: finePercorso(p), primaPredefinita: primaScadenzaPredefinita(p), rate: pianoRate(p) };
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
  }
  // un tipo nuovo scritto a mano diventa selezionabile dalla volta successiva
  if (!TIPI_PERCORSO.includes(d.tipo)) {
    const pool = await db.poolForCliente(clienteId);
    await pool.query('INSERT INTO tipi_percorso (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING', [d.tipo]);
  }
  return id ? db.update(clienteId, 'percorsi', id, d) : db.create(clienteId, 'percorsi', d);
}

module.exports = {
  tipiPercorso, rimuoviTipoPercorso,
  FREQUENZE, periodiAttesi, situazioneRate, statisticheAppuntamenti,
  finePercorso, pianoRate, situazionePercorso, anteprimaPercorso, primaScadenzaPredefinita,
  listPersone, listRate, dettaglioPersona, salvaPersona, salvaPercorso, salvaPagamento,
  caricaDocumento, leggiDocumento, eliminaDocumento
};
