// Dati del cliente autenticato, in sola lettura. ?tipo=cliente|riepilogo|persone|persona|appuntamenti|rate|fatture|acquisti
const s = require('../lib/server');
const { PERSONE_VISIBILI } = require('../lib/campi');
const {
  oggiISO, riepilogoPersone, tutteLeRate, situazioneCompleta, statisticheAppuntamenti
} = require('../lib/calcoli');

const PAG_COLS = 'id, persona_id, periodo, importo, pagato_il, metodo, esente, documento_id, note, percorso_id, numero_rata';
const PERS_COLS = PERSONE_VISIBILI.join(', ');
const SEZIONI_PORTALE = ['anagrafica', 'appuntamenti', 'pagamenti', 'fatture', 'acquisti'];

// sezione che deve essere attiva per ogni tipo di dato
const SEZIONE = {
  persone: 'anagrafica', persona: 'anagrafica', appuntamenti: 'appuntamenti',
  rate: 'pagamenti', fatture: 'fatture', acquisti: 'acquisti'
};

const APP_AGGR = `SELECT persona_id,
    max(inizio) FILTER (WHERE inizio <= now() AND stato IN ('svolto','programmato')) AS ultimo,
    min(inizio) FILTER (WHERE inizio > now() AND stato = 'programmato') AS prossimo
  FROM appuntamenti WHERE persona_id IS NOT NULL GROUP BY persona_id`;

async function base(db) {
  const [persone, percorsi, pagamenti] = await Promise.all([
    db.query(`SELECT ${PERS_COLS} FROM persone ORDER BY cognome, nome`),
    db.query('SELECT * FROM percorsi'),
    db.query(`SELECT ${PAG_COLS} FROM pagamenti`)
  ]);
  return { persone: persone.rows, percorsi: percorsi.rows, pagamenti: pagamenti.rows };
}

const lettori = {
  async riepilogo(db, sezioni) {
    const oggi = oggiISO();
    const mese = oggi.slice(0, 7);
    const out = { oggi };
    if (sezioni.includes('anagrafica') || sezioni.includes('pagamenti')) {
      const b = await base(db);
      const app = (await db.query(APP_AGGR)).rows;
      const persone = riepilogoPersone(b.persone, b.percorsi, b.pagamenti, app, oggi);
      const rate = tutteLeRate(b.persone, b.percorsi, b.pagamenti, oggi);
      const somma = (l) => l.reduce((t, r) => t + (Number(r.importo) || 0), 0);
      const ritardo = rate.filter((r) => r.stato === 'in_ritardo');
      const scadono = rate.filter((r) => r.stato === 'da_pagare' && r.scadenza?.slice(0, 7) === mese);
      const incassate = rate.filter((r) => r.stato === 'pagata' && r.pagamento?.pagato_il?.slice(0, 7) === mese);
      out.persone = {
        attivi: persone.filter((p) => p.situazione.statoPercorso === 'attivo').length,
        daRinnovare: persone.filter((p) => p.situazione.daRinnovare).length,
        inRitardo: persone.filter((p) => p.situazione.inRitardo.length).length
      };
      out.rate = {
        ritardo: { n: ritardo.length, importo: somma(ritardo) },
        scadonoMese: { n: scadono.length, importo: somma(scadono) },
        incassatoMese: { n: incassate.length, importo: somma(incassate) }
      };
      out.ritardi = ritardo
        .sort((a, b) => a.scadenza.localeCompare(b.scadenza))
        .slice(0, 20)
        .map((r) => ({ persona: r.persona, etichetta: r.etichetta, periodo: r.periodo, scadenza: r.scadenza, importo: r.importo }));
      out.daRinnovare = persone
        .filter((p) => p.situazione.daRinnovare)
        .map((p) => ({ id: p.id, nome: p.nome, cognome: p.cognome, percorso: p.situazione.percorsoAttuale }));
    }
    if (sezioni.includes('appuntamenti')) {
      const { rows } = await db.query(
        `SELECT a.id, a.inizio, a.fine, a.titolo, a.stato, a.persona_id, p.nome || ' ' || p.cognome AS persona_nome
           FROM appuntamenti a LEFT JOIN persone p ON p.id = a.persona_id
          WHERE a.inizio > now() AND a.stato = 'programmato' ORDER BY a.inizio LIMIT 8`
      );
      out.prossimi = rows;
    }
    return out;
  },

  async persone(db) {
    const b = await base(db);
    const app = (await db.query(APP_AGGR)).rows;
    return riepilogoPersone(b.persone, b.percorsi, b.pagamenti, app, oggiISO());
  },

  async persona(db, sezioni, q) {
    const id = Number(q.id);
    const [p, percorsi, pagamenti, appuntamenti, contabili] = await Promise.all([
      db.query(`SELECT ${PERS_COLS} FROM persone WHERE id = $1`, [id]),
      db.query('SELECT * FROM percorsi WHERE persona_id = $1', [id]),
      db.query(`SELECT ${PAG_COLS} FROM pagamenti WHERE persona_id = $1`, [id]),
      sezioni.includes('appuntamenti')
        ? db.query('SELECT id, inizio, fine, titolo, luogo, stato, note FROM appuntamenti WHERE persona_id = $1 ORDER BY inizio DESC', [id])
        : { rows: [] },
      // solo i documenti allegati ai pagamenti (contabili): gli altri documenti possono contenere dati sanitari
      db.query(
        `SELECT d.id, d.nome_file, d.mime, d.dimensione, d.descrizione, d.caricato_il
           FROM documenti d JOIN pagamenti pg ON pg.documento_id = d.id
          WHERE pg.persona_id = $1 ORDER BY d.caricato_il DESC`, [id]
      )
    ]);
    if (!p.rows.length) return null;
    const persona = p.rows[0];
    return {
      persona,
      situazione: situazioneCompleta(persona, percorsi.rows, pagamenti.rows, oggiISO()),
      appuntamenti: appuntamenti.rows,
      statistiche: statisticheAppuntamenti(appuntamenti.rows),
      contabili: contabili.rows
    };
  },

  async appuntamenti(db) {
    const { rows } = await db.query(
      `SELECT a.id, a.inizio, a.fine, a.titolo, a.luogo, a.stato, a.note, a.persona_id,
              p.nome || ' ' || p.cognome AS persona_nome
         FROM appuntamenti a LEFT JOIN persone p ON p.id = a.persona_id ORDER BY a.inizio DESC LIMIT 2000`
    );
    return rows;
  },

  async rate(db) {
    const b = await base(db);
    const oggi = oggiISO();
    return { oggi, rate: tutteLeRate(b.persone, b.percorsi, b.pagamenti, oggi) };
  },

  async fatture(db) {
    return (await db.query('SELECT id, numero, data, descrizione, imponibile, iva_perc, stato, note FROM fatture ORDER BY data DESC, id DESC')).rows;
  },

  async acquisti(db) {
    return (await db.query('SELECT id, data, fornitore, descrizione, importo, note FROM acquisti ORDER BY data DESC, id DESC')).rows;
  }
};

module.exports = s.gestisci(async (req, res) => {
  if (req.method !== 'GET') return s.invia(res, 405, { errore: 'Metodo non consentito' });
  const cliente = await s.autentica(req, res);
  if (!cliente) return;
  const sezioni = (cliente.sezioni || []).filter((x) => SEZIONI_PORTALE.includes(x));
  const q = s.query(req);

  if (q.tipo === 'cliente')
    return s.invia(res, 200, { nome: cliente.nome, logo: cliente.logo, colore: cliente.colore, sezioni });

  const lettore = lettori[q.tipo];
  if (!lettore) return s.invia(res, 400, { errore: 'Richiesta non valida' });
  if (SEZIONE[q.tipo] && !sezioni.includes(SEZIONE[q.tipo])) return s.invia(res, 403, { errore: 'Sezione non disponibile' });

  const dati = await lettore(s.pool(cliente.db_name), sezioni, q);
  if (dati === null) return s.invia(res, 404, { errore: 'Non trovato' });
  s.invia(res, 200, dati);
});
