/* global api, SECTIONS, route, clienti, go, $, esc, eur, toast, safe, openForm, fmtDate, fmtDateTime,
   meseLabel, editAppuntamento, tabellaAppuntamenti, collegaAzioniAppuntamenti, boxStatistiche, nomePersona */
'use strict';

// ---------- Anagrafica (es. allievi di un personal trainer) -----------------

const TIPI_PAGAMENTO = [
  ['mensile', 'Mensile'],
  ['bimestrale', 'Bimestrale'],
  ['trimestrale', 'Trimestrale'],
  ['quadrimestrale', 'Quadrimestrale'],
  ['semestrale', 'Semestrale'],
  ['annuale', 'Annuale'],
  ['pacchetto', 'Pacchetto di lezioni (nessuna scadenza automatica)'],
  ['a_lezione', 'A lezione (nessuna scadenza automatica)']
];
const MESI_TIPO = { mensile: 1, bimestrale: 2, trimestrale: 3, quadrimestrale: 4, semestrale: 6, annuale: 12 };
const METODI = [['', '—'], ['contanti', 'Contanti'], ['bonifico', 'Bonifico'], ['carta', 'Carta / POS'], ['satispay', 'Satispay'], ['paypal', 'PayPal'], ['altro', 'Altro']];
const STATI_PERSONA = [['attivo', 'Attivo'], ['sospeso', 'Sospeso'], ['cessato', 'Cessato']];
const ACCEPT_DOC = 'application/pdf,image/*';

// i codici 'personal' e 'personal_nutrizione' restano per compatibilità con i percorsi già salvati
const TIPI_PERCORSO = [['nutrizione', 'Nutrizione'], ['personal', 'Allenamento'], ['personal_nutrizione', 'Nutrizione + Allenamento'], ['trattamento', 'Trattamento'], ['ristrutturazione_edile', 'Ristrutturazione edile']];
const DURATE_MESI = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 18, 24].map((n) => [String(n), n === 1 ? '1 mese' : `${n} mesi`]);
const NUM_RATE = Array.from({ length: 11 }, (_, i) => [String(i + 2), `${i + 2} rate`]);
const STATI_PERCORSO = {
  in_corso: '<span class="badge app-programmato">In corso</span>',
  futuro: '<span class="badge annullata">Da iniziare</span>',
  concluso: '<span class="badge annullata">Concluso</span>'
};

const ALTRO_TIPO = '__altro__';
// nome leggibile di un tipo di percorso (di base o scritto a mano)
const nomeTipo = (k) => (TIPI_PERCORSO.find(([v]) => v === k) || [, k || ''])[1];

const label = (list, k) => (list.find(([v]) => v === k) || [, k || ''])[1];
const tipoBreve = (k) => label(TIPI_PAGAMENTO, k).replace(/ \(.*\)/, '');

const PERSONA_FIELDS = [
  { type: 'heading', label: 'Dati personali' },
  { name: 'nome', label: 'Nome', required: true },
  { name: 'cognome', label: 'Cognome', required: true },
  { name: 'data_nascita', label: 'Data di nascita', type: 'date' },
  { name: 'sesso', label: 'Sesso', type: 'select', options: [['', '—'], ['F', 'Donna'], ['M', 'Uomo'], ['altro', 'Altro']] },
  { name: 'telefono', label: 'Telefono', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'codice_fiscale', label: 'Codice fiscale' },
  { name: 'indirizzo', label: 'Indirizzo' },
  { name: 'contatto_emergenza', label: 'Contatto di emergenza (nome e telefono)', full: true },
  {
    name: 'canale_comunicazione', label: 'Invia le comunicazioni (promemoria rate) via', type: 'select', required: true, full: true,
    options: [['', '— Scegli —'], ['telefono', 'Telefono (WhatsApp)'], ['email', 'Email']]
  },

  { type: 'heading', label: 'Allenamento e salute' },
  { name: 'obiettivo', label: 'Obiettivo', full: true },
  { name: 'livello', label: 'Livello', type: 'select', options: [['', '—'], ['principiante', 'Principiante'], ['intermedio', 'Intermedio'], ['avanzato', 'Avanzato']] },
  { name: 'certificato_scadenza', label: 'Scadenza certificato medico', type: 'date' },
  { name: 'altezza_cm', label: 'Altezza (cm)', type: 'number', step: '0.1' },
  { name: 'peso_kg', label: 'Peso iniziale (kg)', type: 'number', step: '0.1' },
  { name: 'condizioni_salute', label: 'Patologie, infortuni, limitazioni', type: 'textarea' },

  { type: 'heading', label: 'Altro' },
  { name: 'stato', label: 'Stato', type: 'select', options: STATI_PERSONA },
  { name: 'metodo_pagamento', label: 'Metodo di pagamento abituale', type: 'select', options: METODI },
  { name: 'note', label: 'Note', type: 'textarea' }
];

// Campi del percorso (con prefisso p_ quando sono nel modulo "Nuova persona")
const percorsoFields = (px = '', tipiCliente = []) => [
  {
    name: px + 'tipo', label: 'Tipo di percorso', type: 'select', full: true,
    options: [...TIPI_PERCORSO, ...tipiCliente.map((t) => [t, t]), [ALTRO_TIPO, '✏️ Altro… (scrivi un nuovo tipo)']]
  },
  { name: px + 'tipo_altro', label: 'Nuovo tipo di percorso', full: true, required: true, showIf: { field: px + 'tipo', value: ALTRO_TIPO } },
  { name: px + 'data_inizio', label: 'Inizio del percorso', type: 'date', required: true },
  { name: px + 'durata_mesi', label: 'Durata del percorso', type: 'select', options: DURATE_MESI },
  { name: px + 'importo_totale', label: 'Importo totale (€)', type: 'number', step: '0.01', required: true },
  { name: px + 'modalita', label: 'Pagamento', type: 'select', options: [['unica', 'Unica soluzione'], ['rate', 'A rate']] },
  { name: px + 'numero_rate', label: 'Numero di rate', type: 'select', options: NUM_RATE, showIf: { field: px + 'modalita', value: 'rate' } },
  { name: px + 'prima_scadenza', label: 'Scadenza della 1ª rata', type: 'date', required: true },
  { name: px + 'anteprima', type: 'html' }
];

/**
 * Gestisce il campo "Scadenza della 1ª rata" e l'anteprima delle scadenze (calcolata dal programma).
 * La scadenza proposta è l'ultimo giorno lavorativo del mese di inizio: finché non la modifichi a mano
 * segue la data di inizio; se la cambi (es. il 3), tutte le rate scadono il 3 del mese.
 */
function gestoreAnteprima(px = '', primaIniziale = null) {
  let auto = primaIniziale; // ultimo valore proposto automaticamente
  let turno = 0;
  return async (v, form) => {
    const mio = ++turno;
    const campo = form.elements[px + 'prima_scadenza'];
    const box = $('#' + px + 'anteprima');
    const dati = percorsoDaForm(v, px);
    if (!dati.data_inizio || !dati.durata_mesi) { box.innerHTML = ''; return; }
    const base = await api.percorsi.anteprima({ ...dati, prima_scadenza: null }).catch(() => null);
    if (mio !== turno || !base) return;
    // se l'utente non ha toccato la scadenza, la si aggiorna con quella predefinita
    if (!campo.value || campo.value === auto) {
      campo.value = base.primaPredefinita;
      auto = base.primaPredefinita;
    }
    const a = campo.value === base.primaPredefinita ? base : await api.percorsi.anteprima({ ...dati, prima_scadenza: campo.value }).catch(() => null);
    if (mio !== turno || !a) return;
    const it = (d) => new Date(d + 'T00:00:00').toLocaleDateString('it-IT');
    const regola = campo.value === base.primaPredefinita
      ? 'ogni rata scade l\'ultimo giorno lavorativo del mese'
      : `ogni rata scade il giorno ${Number(campo.value.slice(8))} del mese`;
    box.innerHTML = `<div class="anteprima">
      <div class="muted">Il percorso termina il <strong>${it(a.fine)}</strong>. ${a.rate.length > 1 ? `Scadenze (${regola}):` : 'Scadenza:'}
        ${campo.value !== base.primaPredefinita ? ` <a class="link" data-reset-scadenza>usa l'ultimo giorno lavorativo</a>` : ''}</div>
      <ul>${a.rate
        .map((r) => `<li><span>${r.di === 1 ? 'Unica soluzione' : `Rata ${r.numero_rata}`}</span><span>entro il ${it(r.scadenza)}</span><strong>${r.importo !== null ? eur(r.importo) : ''}</strong></li>`)
        .join('')}</ul></div>`;
    const reset = box.querySelector('[data-reset-scadenza]');
    if (reset) reset.onclick = () => { campo.value = ''; form.dispatchEvent(new Event('input')); };
  };
}

const percorsoDaForm = (d, px = '') => ({
  tipo: d[px + 'tipo'] === ALTRO_TIPO ? String(d[px + 'tipo_altro'] || '').trim() : d[px + 'tipo'],
  data_inizio: d[px + 'data_inizio'],
  durata_mesi: Number(d[px + 'durata_mesi']),
  importo_totale: d[px + 'importo_totale'],
  modalita: d[px + 'modalita'],
  numero_rate: d[px + 'modalita'] === 'rate' ? Number(d[px + 'numero_rate']) : 1,
  prima_scadenza: d[px + 'prima_scadenza'] || null
});

const oggiISO = () => new Date().toISOString().slice(0, 10);

async function editPersona(cliente, persona, onDone) {
  const nuovo = !persona;
  const tipiCliente = nuovo ? await api.percorsi.tipi(cliente.id).catch(() => []) : [];
  openForm({
    title: persona ? `Modifica ${persona.nome} ${persona.cognome}` : 'Nuova persona',
    fields: nuovo ? [...PERSONA_FIELDS, { type: 'heading', label: 'Percorso' }, ...percorsoFields('p_', tipiCliente)] : PERSONA_FIELDS,
    values: persona || {
      stato: 'attivo', p_tipo: 'personal', p_data_inizio: oggiISO(), p_durata_mesi: '3', p_modalita: 'unica', p_numero_rate: '3'
    },
    onInput: nuovo ? gestoreAnteprima('p_') : undefined,
    onSubmit: async (d) => {
      const data = Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('p_')));
      if (nuovo) data.percorso = percorsoDaForm(d, 'p_');
      const saved = await api.persone.save(cliente.id, persona?.id, data);
      toast(persona ? 'Dati aggiornati' : 'Persona aggiunta');
      onDone(saved);
    }
  });
}

async function editPercorso(cliente, persona, percorso, onDone, precedente) {
  const tipiCliente = await api.percorsi.tipi(cliente.id).catch(() => []);
  let values;
  // scadenza della 1ª rata: quella reale del percorso; se era la predefinita continua a seguire la data di inizio
  let primaAuto = null;
  if (percorso) {
    values = {
      ...percorso, durata_mesi: String(percorso.durata_mesi), numero_rate: String(percorso.numero_rate),
      prima_scadenza: percorso.prima_scadenza || percorso.rate?.[0]?.scadenza || ''
    };
    if (!percorso.prima_scadenza) primaAuto = values.prima_scadenza;
  }
  else if (precedente) {
    // rinnovo: riparte il giorno dopo la fine del percorso precedente, con le stesse condizioni
    const f = new Date(precedente.fine + 'T00:00:00');
    f.setDate(f.getDate() + 1);
    const inizio = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    values = {
      tipo: precedente.tipo, importo_totale: precedente.importo_totale, modalita: precedente.modalita,
      data_inizio: inizio > oggiISO() ? inizio : oggiISO(), durata_mesi: String(precedente.durata_mesi),
      numero_rate: String(Math.max(precedente.numero_rate, 2)), note: ''
    };
    // se il percorso precedente aveva un giorno di scadenza scelto, il rinnovo lo mantiene
    if (precedente.prima_scadenza) {
      const giorno = Number(precedente.prima_scadenza.slice(8));
      const [yy, mm] = values.data_inizio.split('-').map(Number);
      const ultimo = new Date(yy, mm, 0).getDate();
      values.prima_scadenza = `${values.data_inizio.slice(0, 7)}-${String(Math.min(giorno, ultimo)).padStart(2, '0')}`;
    }
  } else values = { tipo: 'personal', data_inizio: oggiISO(), durata_mesi: '3', modalita: 'unica', numero_rate: '3' };
  const fields = [...percorsoFields('', tipiCliente), { name: 'note', label: 'Note', type: 'textarea' }];
  if (precedente) {
    fields[0] = { ...fields[0], label: 'Cosa rinnova' };
    fields.unshift({ name: 'info_rinnovo', type: 'html' });
  }
  const anteprima = gestoreAnteprima('', primaAuto);
  openForm({
    title: percorso ? 'Modifica percorso' : precedente ? `Rinnovo · ${persona.nome} ${persona.cognome}` : 'Nuovo percorso',
    fields,
    values,
    onInput: (v, form) => {
      anteprima(v, form);
      if (precedente)
        $('#info_rinnovo').innerHTML = `<div class="rinnovo-info"><span class="muted">Percorso precedente</span>
          <strong>${esc(nomeTipo(precedente.tipo))}</strong> · ${precedente.durata_mesi} ${precedente.durata_mesi === 1 ? 'mese' : 'mesi'}
          · dal ${fmtDate(precedente.data_inizio)} al ${fmtDate(precedente.fine)}
          · ${precedente.importo_totale !== null ? eur(precedente.importo_totale) : '—'} ${precedente.modalita === 'rate' ? `in ${precedente.numero_rate} rate` : 'in unica soluzione'}</div>`;
    },
    onSubmit: async (d) => {
      await api.percorsi.save(cliente.id, percorso?.id, {
        ...percorsoDaForm(d), note: d.note, persona_id: persona.id, ...(precedente ? { rinnovo_di: precedente.id } : {})
      });
      toast(percorso ? 'Percorso aggiornato' : precedente ? 'Rinnovo registrato' : 'Percorso creato');
      onDone();
    }
  });
}

function badgePercorso(pa, sit) {
  if (!pa) return '<span class="muted">Nessun percorso</span>';
  const rinnovi = sit?.numRinnovi ? ` <span class="badge rinnovo" title="Rinnovi effettuati">↻ ${sit.numRinnovi === 1 ? 'Rinnovato' : `Rinnovato ${sit.numRinnovi} volte`}</span>` : '';
  let extra = '';
  if (sit?.daRinnovare)
    extra = ` <span class="badge warn">Da rinnovare · ${pa.giorniAllaFine <= 0 ? 'termina oggi' : `termina tra ${pa.giorniAllaFine} gg`}</span>`;
  else if (pa.stato === 'concluso') extra = ' <span class="badge annullata">Concluso</span>';
  else if (pa.stato === 'futuro') extra = ' <span class="badge annullata">Da iniziare</span>';
  return `${esc(nomeTipo(pa.tipo))}${rinnovi}<div class="muted small">fino al ${fmtDate(pa.fine)}${extra}</div>`;
}

// ---------- Gestione dei tipi di percorso -------------------------------------
async function gestisciTipi(cliente, onClose) {
  const dlg = $('#tipi-dialog') || document.body.appendChild(Object.assign(document.createElement('dialog'), { id: 'tipi-dialog' }));
  dlg.onclose = () => onClose && onClose();

  const disegna = async () => {
    const tipi = await safe(() => api.percorsi.elencoTipi(cliente.id));
    const attivi = tipi.filter((t) => !t.nascosto);
    const nascosti = tipi.filter((t) => t.nascosto);
    const uso = (n) => (n ? `<span class="muted small">usato in ${n} ${n === 1 ? 'percorso' : 'percorsi'}</span>` : '<span class="muted small">non ancora usato</span>');
    dlg.innerHTML = `
      <h2>Tipi di percorso · ${esc(cliente.nome)}</h2>
      <h4 class="tipi-titolo">Di base (sempre disponibili)</h4>
      <div class="tipi-base">${TIPI_PERCORSO.map(([, n]) => `<span class="badge annullata">${esc(n)}</span>`).join(' ')}</div>
      <h4 class="tipi-titolo">Aggiunti per questo cliente</h4>
      <div class="tipi-lista">${
        attivi.length
          ? attivi.map((t) => `<div class="tipo-riga">
              <div class="grow"><strong>${esc(t.nome)}</strong> ${uso(t.percorsi)}</div>
              <button class="btn small" data-rinomina="${esc(t.nome)}">Rinomina</button>
              <button class="btn small danger" data-elimina="${esc(t.nome)}">Elimina</button></div>`).join('')
          : '<div class="muted">Nessun tipo aggiunto.</div>'
      }</div>
      ${nascosti.length ? `<h4 class="tipi-titolo">Eliminati (restano solo sui percorsi già creati)</h4>
        <div class="tipi-lista">${nascosti.map((t) => `<div class="tipo-riga nascosto">
          <div class="grow">${esc(t.nome)} ${uso(t.percorsi)}</div>
          <button class="btn small" data-ripristina="${esc(t.nome)}">Ripristina</button></div>`).join('')}</div>` : ''}
      <form id="tipo-nuovo" class="tipo-nuovo">
        <input name="nome" placeholder="Nuovo tipo, es. Pilates" maxlength="60" required>
        <button class="btn primary" type="submit">＋ Aggiungi</button>
      </form>
      <div class="modal-actions"><button class="btn" id="tipi-chiudi">Chiudi</button></div>`;

    $('#tipi-chiudi').onclick = () => dlg.close();
    $('#tipo-nuovo').onsubmit = async (e) => {
      e.preventDefault();
      await safe(() => api.percorsi.aggiungiTipo(cliente.id, e.target.nome.value));
      toast('Tipo aggiunto');
      disegna();
    };
    dlg.querySelectorAll('[data-rinomina]').forEach((b) => (b.onclick = () => {
      const vecchio = b.dataset.rinomina;
      const riga = b.closest('.tipo-riga');
      riga.innerHTML = `<form class="tipo-nuovo rinomina">
          <input name="nome" value="${esc(vecchio)}" maxlength="60" required>
          <button class="btn small primary" type="submit">Salva</button>
          <button class="btn small" type="button" data-annulla>Annulla</button>
        </form>
        <div class="muted small">Il nuovo nome vale anche per i percorsi che usano già “${esc(vecchio)}”.</div>`;
      const f = riga.querySelector('form');
      f.nome.focus();
      f.nome.select();
      riga.querySelector('[data-annulla]').onclick = () => disegna();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const nuovo = f.nome.value.trim();
        if (nuovo && nuovo !== vecchio) {
          await safe(() => api.percorsi.rinominaTipo(cliente.id, vecchio, nuovo));
          toast('Tipo rinominato');
        }
        disegna();
      };
    }));
    dlg.querySelectorAll('[data-elimina]').forEach((b) => (b.onclick = async () => {
      const t = tipi.find((x) => x.nome === b.dataset.elimina);
      const msg = t.percorsi
        ? `"${t.nome}" è usato in ${t.percorsi} ${t.percorsi === 1 ? 'percorso' : 'percorsi'}: resterà su quelli, ma non sarà più selezionabile. Continuare?`
        : `Eliminare il tipo "${t.nome}"?`;
      if (!confirm(msg)) return;
      await safe(() => api.percorsi.rimuoviTipo(cliente.id, t.nome));
      toast('Tipo eliminato');
      disegna();
    }));
    dlg.querySelectorAll('[data-ripristina]').forEach((b) => (b.onclick = async () => {
      await safe(() => api.percorsi.ripristinaTipo(cliente.id, b.dataset.ripristina));
      toast('Tipo di nuovo selezionabile');
      disegna();
    }));
  };
  await disegna();
  if (!dlg.open) dlg.showModal();
}

/** Etichetta del periodo coperto da una rata: "novembre 2026" o "ottobre – dicembre 2026". */
function periodoLabel(r) {
  if (r.etichetta) return r.etichetta;
  if (!r.periodo) return 'Pagamento extra';
  if (!r.fino_al || r.fino_al.slice(0, 7) === r.periodo.slice(0, 7)) return meseLabel(r.periodo);
  const da = new Date(r.periodo + 'T00:00:00');
  const a = new Date(r.fino_al + 'T00:00:00');
  const mese = (d, anno) => d.toLocaleDateString('it-IT', anno ? { month: 'long', year: 'numeric' } : { month: 'long' });
  return `${mese(da, da.getFullYear() !== a.getFullYear())} – ${mese(a, true)}`;
}

function badgePagamenti(s) {
  if (s.inRitardo.length)
    return `<span class="badge late">⚠ ${s.inRitardo.length} ${s.inRitardo.length === 1 ? 'rata' : 'rate'} in ritardo · ${eur(s.importoInRitardo)}</span>`;
  if (s.prossimaScadenza) return `<span class="badge da_pagare">Da pagare entro il ${fmtDate(s.prossimaScadenza)}</span>`;
  return '<span class="badge pagata">In regola</span>';
}

const fileDaInput = async (file) =>
  file ? { name: file.name, mime: file.type || 'application/octet-stream', data: new Uint8Array(await file.arrayBuffer()) } : null;

// ---------- Elenco ------------------------------------------------------------
let filtroPersone = { testo: '', vista: 'attivi' };

const FILTRI_PERSONE = {
  attivi: (p) => p.situazione.statoPercorso === 'attivo',
  da_rinnovare: (p) => p.situazione.daRinnovare,
  terminati: (p) => p.situazione.statoPercorso === 'terminato',
  rinnovati: (p) => p.situazione.numRinnovi > 0,
  ritardo: (p) => p.situazione.inRitardo.length > 0,
  tutti: () => true
};
let cercaTimer;

async function renderElencoPersone(cliente, el) {
  const persone = await safe(() => api.persone.list(cliente.id));
  const q = filtroPersone.testo.toLowerCase();
  const lista = persone.filter((p) => {
    if (q && !`${p.nome} ${p.cognome} ${p.telefono || ''} ${p.email || ''}`.toLowerCase().includes(q)) return false;
    return FILTRI_PERSONE[filtroPersone.vista](p);
  });
  const conta = Object.fromEntries(Object.entries(FILTRI_PERSONE).map(([k, f]) => [k, persone.filter(f).length]));
  const nRitardo = conta.ritardo;
  const conPercorso = persone.filter((p) => p.situazione.numPercorsi).length;
  const tasso = conPercorso ? Math.round((conta.rinnovati / conPercorso) * 100) : 0;

  el.innerHTML = `
    <div class="cards cards-filter">
      ${[
        ['attivi', 'Attivi', 'percorso in corso'],
        ['da_rinnovare', 'Da rinnovare', 'terminano entro 30 giorni'],
        ['terminati', 'Terminati', 'non hanno rinnovato'],
        ['rinnovati', 'Rinnovati', `${tasso}% di chi ha fatto un percorso`],
        ['ritardo', 'In ritardo', 'rate non pagate'],
        ['tutti', 'Tutti', 'in anagrafica']
      ]
        .map(
          ([k, l, sub]) => `<button class="card card-btn ${filtroPersone.vista === k ? 'selected' : ''} ${k === 'ritardo' && nRitardo ? 'card-alert' : ''} ${k === 'da_rinnovare' && conta[k] ? 'card-warn' : ''}" data-vista="${k}">
            <div class="label">${l}</div><div class="value">${conta[k]}</div><div class="muted">${sub}</div></button>`
        )
        .join('')}
    </div>
    <div class="toolbar">
      <input id="f-persone" class="search-input" placeholder="Cerca per nome, telefono, email…" value="${esc(filtroPersone.testo)}">
      <div class="spacer"></div>
      <button class="btn" id="btn-tipi-percorso">⚙ Tipi di percorso</button>
      <button class="btn primary" id="btn-add-persona">＋ Nuova persona</button>
    </div>
    <div class="table-wrap"><table class="clickable">
      <thead><tr><th>Nome</th><th>Telefono</th><th>Percorso</th><th>Situazione rate</th><th>Ultimo appuntamento</th><th>Prossimo</th></tr></thead>
      <tbody>${
        lista.length
          ? lista
              .map(
                (p) => `<tr data-persona-row="${p.id}" class="${p.situazione.inRitardo.length ? 'row-late' : ''} ${p.stato === 'cessato' ? 'row-muted' : ''}">
                  <td><strong>${esc(p.cognome)} ${esc(p.nome)}</strong>
                    ${p.stato !== 'attivo' ? ` <span class="badge annullata">${esc(label(STATI_PERSONA, p.stato))}</span>` : ''}
                    ${p.situazione.certificatoScaduto ? ' <span class="badge late" title="Certificato medico scaduto">Certificato scaduto</span>' : ''}</td>
                  <td>${esc(p.telefono)}</td>
                  <td>${p.situazione.percorsoAttuale || !MESI_TIPO[p.tipo_pagamento] ? badgePercorso(p.situazione.percorsoAttuale, p.situazione) : `${esc(tipoBreve(p.tipo_pagamento))}${p.importo ? ` · ${eur(p.importo)}` : ''}`}</td>
                  <td>${badgePagamenti(p.situazione)}${p.situazione.ricevuteMancanti ? ` <span class="badge warn" title="Pagamenti senza contabile">${p.situazione.ricevuteMancanti} senza contabile</span>` : ''}</td>
                  <td>${p.situazione.ultimoAppuntamento ? fmtDate(p.situazione.ultimoAppuntamento) : '<span class="muted">—</span>'}</td>
                  <td>${p.situazione.prossimoAppuntamento ? fmtDateTime(p.situazione.prossimoAppuntamento) : '<span class="muted">—</span>'}</td>
                </tr>`
              )
              .join('')
          : `<tr><td class="empty-row" colspan="6">${persone.length ? 'Nessuna persona corrisponde ai filtri.' : 'Nessuna persona in anagrafica. Aggiungi la prima con “Nuova persona”.'}</td></tr>`
      }</tbody>
    </table></div>`;

  const refresh = () => renderElencoPersone(cliente, el);
  const search = $('#f-persone');
  search.oninput = () => {
    clearTimeout(cercaTimer);
    cercaTimer = setTimeout(() => {
      filtroPersone.testo = search.value;
      const pos = search.selectionStart;
      refresh().then(() => { const s = $('#f-persone'); s.focus(); s.setSelectionRange(pos, pos); });
    }, 300);
  };
  el.querySelectorAll('[data-vista]').forEach((b) => (b.onclick = () => { filtroPersone.vista = b.dataset.vista; refresh(); }));
  $('#btn-add-persona').onclick = () => editPersona(cliente, null, (p) => apriPersona(p.id));
  $('#btn-tipi-percorso').onclick = () => gestisciTipi(cliente, refresh);
  el.querySelectorAll('[data-persona-row]').forEach((tr) => (tr.onclick = () => apriPersona(Number(tr.dataset.personaRow))));
}

function apriPersona(personaId) {
  go({ name: 'cliente', id: route.id, tab: 'anagrafica', personaId });
}

// ---------- Scheda persona ----------------------------------------------------

async function renderPersona(cliente, el, personaId) {
  const d = await safe(() => api.persone.get(cliente.id, personaId));
  const p = d.persona;
  const s = d.situazione;
  const legacy = s.legacy;
  // tutte le rate della pagina in un unico elenco: i pulsanti fanno riferimento all'indice
  const rateFlat = [...s.percorsi.flatMap((x) => x.rate), ...legacy.rate];
  let offset = 0;
  const tab = (rows) => { const html = tabellaRate(rows, offset); offset += rows.length; return html; };
  const refresh = () => renderPersona(cliente, el, personaId);
  const now = new Date();
  const prossimi = d.appuntamenti.filter((a) => new Date(a.inizio) > now).reverse();
  const storico = d.appuntamenti.filter((a) => new Date(a.inizio) <= now);

  const info = [
    ['Telefono', p.telefono], ['Email', p.email], ['Data di nascita', p.data_nascita && `${fmtDate(p.data_nascita)} (${eta(p.data_nascita)} anni)`],
    ['Comunicazioni', p.canale_comunicazione === 'email' ? `Email · ${p.email || '⚠ manca l’indirizzo'}` : p.canale_comunicazione === 'telefono' ? `WhatsApp · ${p.telefono || '⚠ manca il numero'}` : '⚠ Canale non scelto'],
    ['Codice fiscale', p.codice_fiscale], ['Indirizzo', p.indirizzo], ['Contatto di emergenza', p.contatto_emergenza],
    ['Obiettivo', p.obiettivo], ['Livello', p.livello], ['Altezza', p.altezza_cm && `${p.altezza_cm} cm`], ['Peso iniziale', p.peso_kg && `${p.peso_kg} kg`],
    ['Certificato medico', p.certificato_scadenza && `scade il ${fmtDate(p.certificato_scadenza)}${d.certificatoScaduto ? ' — SCADUTO' : ''}`],
    ['Cliente dal', fmtDate(p.data_inizio)],
    ['Pagamento abituale', p.metodo_pagamento && label(METODI, p.metodo_pagamento)],
    ...(MESI_TIPO[p.tipo_pagamento] ? [['Abbonamento', `${tipoBreve(p.tipo_pagamento)}${p.importo ? ` · ${eur(p.importo)}` : ''}`]] : [])
  ].filter(([, v]) => v);

  el.innerHTML = `
    <a class="link back" id="btn-back">← Torna all'anagrafica</a>
    <div class="persona-header ${s.inRitardo.length ? 'late' : ''}">
      <div>
        <h2>${esc(p.nome)} ${esc(p.cognome)}</h2>
        <div class="badges">
          ${p.stato !== 'attivo' ? `<span class="badge annullata">${esc(label(STATI_PERSONA, p.stato))}</span>` : ''}
          ${badgePagamenti({ ...s })}
          ${d.certificatoScaduto ? '<span class="badge late">Certificato medico scaduto</span>' : ''}
        </div>
      </div>
      <div class="btn-row">
        ${s.percorsi.length ? '<button class="btn primary" id="btn-rinnovo-top">↻ Rinnovo</button>' : ''}
        <button class="btn" id="btn-edit-persona">Modifica dati</button>
        <button class="btn danger" id="btn-del-persona">Elimina</button>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h3>Dati</h3>
        <dl class="kv">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${p.condizioni_salute ? `<h4>Patologie, infortuni, limitazioni</h4><p class="prewrap">${esc(p.condizioni_salute)}</p>` : ''}
        ${p.note ? `<h4>Note</h4><p class="prewrap">${esc(p.note)}</p>` : ''}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Frequenza</h3><button class="btn small primary" id="btn-add-app-p">＋ Appuntamento</button></div>
        ${boxStatistiche(d.statistiche)}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Percorsi e pagamenti</h3>
        <div class="btn-row">
          ${s.percorsi.length ? '<button class="btn small" id="btn-rinnovo">↻ Rinnova percorso</button>' : ''}
          <button class="btn small primary" id="btn-new-percorso">＋ Nuovo percorso</button>
        </div>
      </div>
      ${
        s.percorsi.length
          ? s.percorsi
              .map(
                (pc) => `<div class="percorso ${pc.rate.some((r) => r.stato === 'in_ritardo') ? 'late' : ''}">
                  <div class="percorso-head">
                    <div>
                      <strong>${esc(nomeTipo(pc.tipo))}</strong> ${STATI_PERCORSO[pc.stato]}
                      ${pc.rinnovo_di ? '<span class="badge rinnovo">↻ Rinnovo</span>' : ''}
                      ${pc.stato === 'in_corso' && pc.giorniAllaFine <= 30 && !s.percorsi.some((x) => x.stato === 'futuro') ? `<span class="badge warn">Da rinnovare · termina tra ${Math.max(pc.giorniAllaFine, 0)} gg</span>` : ''}
                      <div class="muted small">
                        ${pc.durata_mesi === 1 ? '1 mese' : `${pc.durata_mesi} mesi`} · dal ${fmtDate(pc.data_inizio)} al ${fmtDate(pc.fine)}
                        · ${pc.importo_totale !== null ? eur(pc.importo_totale) : '—'} ${pc.modalita === 'rate' ? `in ${pc.numero_rate} rate` : 'in unica soluzione'}
                        · pagato ${eur(pc.pagato)}
                      </div>
                      ${pc.note ? `<div class="muted small">${esc(pc.note)}</div>` : ''}
                    </div>
                    <div class="btn-row">
                      <button class="btn small" data-perc-edit="${pc.id}">Modifica</button>
                      <button class="btn small danger" data-perc-del="${pc.id}">Elimina</button>
                    </div>
                  </div>
                  ${tab(pc.rate)}
                </div>`
              )
              .join('')
          : '<div class="muted empty-box">Nessun percorso. Crea il primo con “Nuovo percorso”.</div>'
      }
      ${
        legacy.rate.length
          ? `<h4>${MESI_TIPO[p.tipo_pagamento] ? `Abbonamento ${tipoBreve(p.tipo_pagamento).toLowerCase()}` : 'Altri pagamenti'}</h4>${tab(legacy.rate)}`
          : ''
      }
      <div style="margin-top:10px"><button class="btn small ghost" id="btn-extra">＋ Altro pagamento</button></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Prossimi appuntamenti</h3></div>
      ${tabellaAppuntamenti(prossimi, { mostraPersona: false, vuoto: 'Nessun appuntamento in programma.' })}
      <h3 style="margin-top:20px">Storico appuntamenti</h3>
      ${tabellaAppuntamenti(storico, { mostraPersona: false, vuoto: 'Nessun appuntamento passato.' })}
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Documenti</h3><button class="btn small" id="btn-add-doc">＋ Carica documento</button></div>
      ${
        d.documenti.length
          ? `<div class="table-wrap"><table><tbody>${d.documenti
              .map(
                (doc) => `<tr><td>📄 <a class="link" data-doc-open="${doc.id}">${esc(doc.nome_file)}</a></td>
                  <td class="muted">${esc(doc.descrizione)}</td><td class="muted">${fmtDate(doc.caricato_il)}</td>
                  <td class="muted num">${Math.ceil(doc.dimensione / 1024)} KB</td>
                  <td class="row-actions"><button class="btn small danger" data-doc-del="${doc.id}">Elimina</button></td></tr>`
              )
              .join('')}</tbody></table></div>`
          : '<div class="muted empty-box">Nessun documento. Qui puoi caricare certificato medico, consenso privacy, contabili…</div>'
      }
    </div>`;

  $('#btn-back').onclick = () => go({ name: 'cliente', id: route.id, tab: 'anagrafica' });
  $('#btn-edit-persona').onclick = () => editPersona(cliente, p, refresh);
  $('#btn-del-persona').onclick = async () => {
    if (!confirm(`Eliminare ${p.nome} ${p.cognome}? Verranno eliminati anche pagamenti e documenti. Per conservare lo storico usa piuttosto lo stato "Cessato".`)) return;
    await safe(() => api.records.remove(cliente.id, 'persone', p.id));
    toast('Persona eliminata');
    go({ name: 'cliente', id: route.id, tab: 'anagrafica' });
  };
  $('#btn-add-app-p').onclick = () => editAppuntamento(cliente, null, { personaId: p.id, onDone: refresh });
  $('#btn-extra').onclick = () => registraPagamento(cliente, p, null, refresh);
  $('#btn-new-percorso').onclick = () => editPercorso(cliente, p, null, refresh);
  const rinnova = () => editPercorso(cliente, p, null, refresh, s.percorsi[0]);
  if ($('#btn-rinnovo')) $('#btn-rinnovo').onclick = rinnova;
  if ($('#btn-rinnovo-top')) $('#btn-rinnovo-top').onclick = rinnova;
  el.querySelectorAll('[data-perc-edit]').forEach(
    (b) => (b.onclick = () => editPercorso(cliente, p, s.percorsi.find((x) => x.id === Number(b.dataset.percEdit)), refresh))
  );
  el.querySelectorAll('[data-perc-del]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Eliminare questo percorso? Verranno eliminati anche i pagamenti registrati sulle sue rate.')) return;
        await safe(() => api.records.remove(cliente.id, 'percorsi', Number(b.dataset.percDel)));
        toast('Percorso eliminato');
        refresh();
      })
  );
  $('#btn-add-doc').onclick = () => caricaDocumento(cliente, p, refresh);

  collegaAzioniAppuntamenti(el, cliente, d.appuntamenti, refresh);

  el.querySelectorAll('[data-rata-paga]').forEach(
    (b) => (b.onclick = () => registraPagamento(cliente, p, rateFlat[Number(b.dataset.rataPaga)], refresh))
  );
  el.querySelectorAll('[data-rata-esente]').forEach(
    (b) =>
      (b.onclick = async () => {
        const r = rateFlat[Number(b.dataset.rataEsente)];
        openForm({
          title: `Segna come non dovuta · ${periodoLabel(r)}`,
          fields: [{ name: 'motivo', label: 'Motivo (facoltativo), es. sospensione, vacanza', full: true }],
          values: { motivo: 'Sospensione' },
          onSubmit: async ({ motivo }) => {
            await api.pagamenti.save(cliente.id, {
              persona_id: p.id, periodo: r.periodo, percorso_id: r.percorso_id, numero_rata: r.numero_rata, esente: true, importo: 0, note: motivo
            });
            toast('Rata segnata come non dovuta');
            aggiornaRitardi();
            refresh();
          }
        });
      })
  );
  el.querySelectorAll('[data-rata-edit]').forEach(
    (b) => (b.onclick = () => registraPagamento(cliente, p, rateFlat[Number(b.dataset.rataEdit)], refresh))
  );
  el.querySelectorAll('[data-rata-del]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Annullare questo pagamento? La rata tornerà da pagare.')) return;
        await safe(() => api.records.remove(cliente.id, 'pagamenti', Number(b.dataset.rataDel)));
        aggiornaRitardi();
        refresh();
      })
  );
  el.querySelectorAll('[data-rata-upload]').forEach(
    (b) => (b.onclick = () => registraPagamento(cliente, p, rateFlat[Number(b.dataset.rataUpload)], refresh, true))
  );
  el.querySelectorAll('[data-doc-open]').forEach((a) => (a.onclick = () => safe(() => api.documenti.open(cliente.id, Number(a.dataset.docOpen)))));
  el.querySelectorAll('[data-doc-del]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Eliminare questo documento?')) return;
        await safe(() => api.documenti.remove(cliente.id, Number(b.dataset.docDel)));
        refresh();
      })
  );
}

function eta(dataNascita) {
  const n = new Date(dataNascita + 'T00:00:00');
  const o = new Date();
  let a = o.getFullYear() - n.getFullYear();
  if (o.getMonth() < n.getMonth() || (o.getMonth() === n.getMonth() && o.getDate() < n.getDate())) a--;
  return a;
}

function tabellaRate(rate, offset = 0) {
  if (!rate.length) return '<div class="muted empty-box">Nessuna rata.</div>';
  const statoBadge = {
    pagata: '<span class="badge pagata">Pagata</span>',
    esente: '<span class="badge annullata">Non dovuta</span>',
    da_pagare: '<span class="badge da_pagare">Da pagare</span>',
    in_ritardo: '<span class="badge late">⚠ In ritardo</span>'
  };
  return `<div class="table-wrap"><table>
    <thead><tr><th>Rata</th><th>Scadenza</th><th class="num">Importo</th><th>Stato</th><th>Pagata il</th><th>Contabile</th><th></th></tr></thead>
    <tbody>${rate
      .map((r, j) => {
        const i = j + offset;
        const pag = r.pagamento;
        let ricevuta = '';
        if (pag?.documento_id) ricevuta = `<a class="link" data-doc-open="${pag.documento_id}">📄 Apri</a>`;
        else if (r.ricevuta_mancante) ricevuta = `<button class="btn small warn-btn" data-rata-upload="${i}">Carica contabile</button>`;
        return `<tr class="${r.stato === 'in_ritardo' ? 'row-late' : ''}">
          <td><strong>${esc(periodoLabel(r))}</strong>${pag?.note ? `<div class="muted small">${esc(pag.note)}</div>` : ''}</td>
          <td>${r.scadenza ? fmtDate(r.scadenza) : '—'}</td>
          <td class="num">${r.importo !== null && r.importo !== undefined ? eur(r.importo) : '—'}</td>
          <td>${statoBadge[r.stato]}</td>
          <td>${pag && !pag.esente ? `${fmtDate(pag.pagato_il)}${pag.metodo ? ` · ${esc(label(METODI, pag.metodo))}` : ''}` : ''}</td>
          <td>${ricevuta}</td>
          <td class="row-actions">${
            pag
              ? `<button class="btn small" data-rata-edit="${i}">Modifica</button><button class="btn small danger" data-rata-del="${pag.id}">Annulla</button>`
              : `<button class="btn small primary" data-rata-paga="${i}">Registra pagamento</button><button class="btn small" data-rata-esente="${i}" title="Es. sospensione o vacanza">Non dovuta</button>`
          }</td></tr>`;
      })
      .join('')}</tbody></table></div>`;
}

/** Registra o modifica il pagamento di una rata (o un pagamento extra), con PDF della ricevuta. */
function registraPagamento(cliente, persona, rata, onDone, soloRicevuta = false) {
  const pag = rata?.pagamento;
  const oggi = new Date().toISOString().slice(0, 10);
  const fields = soloRicevuta
    ? [{ name: 'ricevuta', label: 'Contabile (PDF o foto)', type: 'file', accept: ACCEPT_DOC, required: true }]
    : [
        ...(rata?.periodo || rata?.percorso_id ? [] : [{ name: 'periodo', label: 'Mese di riferimento (facoltativo)', type: 'month' }]),
        { name: 'importo', label: 'Importo pagato (€)', type: 'number', step: '0.01', required: true },
        { name: 'pagato_il', label: 'Pagato il', type: 'date', required: true },
        { name: 'metodo', label: 'Metodo', type: 'select', options: METODI },
        { name: 'ricevuta', label: pag?.documento_id ? 'Sostituisci contabile (facoltativo)' : 'Contabile (PDF o foto)', type: 'file', accept: ACCEPT_DOC },
        { name: 'note', label: 'Note', type: 'textarea' }
      ];
  openForm({
    title: soloRicevuta
      ? `Contabile · ${periodoLabel(rata)}`
      : `${pag ? 'Modifica pagamento' : 'Registra pagamento'}${rata?.periodo || rata?.percorso_id ? ` · ${periodoLabel(rata)}` : ''}`,
    fields,
    values: pag
      ? { ...pag, periodo: pag.periodo?.slice(0, 7) }
      : { importo: rata?.importo ?? persona.importo ?? '', pagato_il: oggi, metodo: persona.metodo_pagamento || '' },
    onSubmit: async (data) => {
      const file = await fileDaInput(data.ricevuta);
      const periodo = rata?.periodo || (!rata?.percorso_id && data.periodo ? `${data.periodo}-01` : null);
      const rif = rata?.percorso_id ? { percorso_id: rata.percorso_id, numero_rata: rata.numero_rata } : {};
      const descrizione_ricevuta = rata?.percorso_id ? `Contabile ${periodoLabel(rata).toLowerCase()} (scad. ${fmtDate(rata.scadenza)})` : undefined;
      const payload = soloRicevuta
        ? { ...pag }
        : { ...(pag || {}), ...rif, persona_id: persona.id, periodo, importo: data.importo, pagato_il: data.pagato_il, metodo: data.metodo, note: data.note, esente: false };
      await api.pagamenti.save(cliente.id, { ...payload, persona_id: persona.id, descrizione_ricevuta }, file);
      toast(soloRicevuta ? 'Contabile caricata' : 'Pagamento registrato');
      await aggiornaRitardi();
      onDone();
    }
  });
}

function caricaDocumento(cliente, persona, onDone) {
  openForm({
    title: 'Carica documento',
    fields: [
      { name: 'file', label: 'File (PDF o immagine)', type: 'file', accept: ACCEPT_DOC, required: true },
      { name: 'descrizione', label: 'Descrizione', full: true }
    ],
    values: { descrizione: '' },
    onSubmit: async (data) => {
      await api.documenti.upload(cliente.id, persona.id, await fileDaInput(data.file), data.descrizione);
      toast('Documento caricato');
      onDone();
    }
  });
}

// ---------- Registrazione sezione -------------------------------------------

SECTIONS.anagrafica = {
  label: 'Anagrafica clienti',
  descrizione: 'Persone, percorsi, rate e contabili',
  render: (cliente, el) => (route.personaId ? renderPersona(cliente, el, route.personaId) : renderElencoPersone(cliente, el))
};

// Link "persona" nelle tabelle appuntamenti: apre la scheda se l'anagrafica è attiva
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-open-persona]');
  if (!a) return;
  e.preventDefault();
  const cliente = clienti.find((c) => c.id === route.id);
  if (cliente && (cliente.sezioni || []).includes('anagrafica')) apriPersona(Number(a.dataset.openPersona));
});

