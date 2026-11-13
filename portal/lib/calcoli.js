// Calcoli condivisi tra app desktop e portale web (nessun accesso al database):
// rate e scadenze, ritardi, percorsi, rinnovi, statistiche degli appuntamenti.
const { ultimoLavorativo } = require('./calendario');

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

/** Scadenza predefinita della 1ª rata: ultimo giorno lavorativo del mese di inizio. */
function primaScadenzaPredefinita(p) {
  const [y, m] = p.data_inizio.split('-').map(Number);
  return ultimoLavorativo(y, m);
}

/**
 * Piano rate di un percorso. L'importo totale viene diviso in parti uguali
 * (l'ultima rata assorbe gli arrotondamenti). Le rate sono distribuite lungo la durata
 * (6 mesi in 3 rate = una ogni 2 mesi).
 * - Predefinito: ogni rata scade l'ultimo giorno lavorativo del suo mese.
 * - Se è indicata la scadenza della 1ª rata (es. il 3), tutte le rate scadono quel giorno
 *   del mese (se il mese è più corto, l'ultimo giorno del mese).
 */
function pianoRate(p) {
  const n = p.modalita === 'rate' ? Math.max(1, p.numero_rate) : 1;
  const totale = Number(p.importo_totale) || 0;
  const base = Math.floor((totale / n) * 100) / 100;
  const passo = Math.max(1, Math.floor(p.durata_mesi / n));
  let [y, m] = p.data_inizio.split('-').map(Number);
  let giorno = null;
  if (p.prima_scadenza) [y, m, giorno] = p.prima_scadenza.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const [ry, rm] = addMonths(y, m, i * passo);
    return {
      numero_rata: i + 1,
      di: n,
      scadenza: giorno ? iso(ry, rm, Math.min(giorno, lastDay(ry, rm))) : ultimoLavorativo(ry, rm),
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

/** Riepilogo per l'elenco persone (situazione rate, percorso attuale, ultimo/prossimo appuntamento). */
function riepilogoPersone(persone, percorsi, pagamenti, appuntamentiAggregati, oggi = oggiISO()) {
  const appMap = new Map(appuntamentiAggregati.map((r) => [r.persona_id, r]));
  return persone.map((p) => {
    const s = situazioneCompleta(p, percorsi, pagamenti.filter((x) => x.persona_id === p.id), oggi);
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

/** Tutte le rate di tutte le persone, con i dati essenziali della persona. */
function tutteLeRate(persone, percorsi, pagamenti, oggi = oggiISO()) {
  const rate = [];
  for (const p of persone) {
    const s = situazioneCompleta(p, percorsi, pagamenti.filter((x) => x.persona_id === p.id), oggi);
    const persona = { id: p.id, nome: p.nome, cognome: p.cognome, stato: p.stato, importo: p.importo, metodo_pagamento: p.metodo_pagamento };
    for (const pc of s.percorsi)
      for (const r of pc.rate) rate.push({ ...r, persona, tipo_percorso: pc.tipo, percorso_fine: pc.fine });
    for (const r of s.legacy.rate) rate.push({ ...r, persona, tipo_percorso: null });
  }
  return rate;
}

module.exports = {
  FREQUENZE, TIPI_PERCORSO, MODALITA, oggiISO, addMonths, lastDay, iso,
  periodiAttesi, situazioneRate, finePercorso, primaScadenzaPredefinita, pianoRate,
  situazionePercorso, situazioneCompleta, statisticheAppuntamenti, riepilogoPersone, tutteLeRate
};
