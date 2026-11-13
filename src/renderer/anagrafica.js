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

  { type: 'heading', label: 'Allenamento e salute' },
  { name: 'obiettivo', label: 'Obiettivo', full: true },
  { name: 'livello', label: 'Livello', type: 'select', options: [['', '—'], ['principiante', 'Principiante'], ['intermedio', 'Intermedio'], ['avanzato', 'Avanzato']] },
  { name: 'certificato_scadenza', label: 'Scadenza certificato medico', type: 'date' },
  { name: 'altezza_cm', label: 'Altezza (cm)', type: 'number', step: '0.1' },
  { name: 'peso_kg', label: 'Peso iniziale (kg)', type: 'number', step: '0.1' },
  { name: 'condizioni_salute', label: 'Patologie, infortuni, limitazioni', type: 'textarea' },

  { type: 'heading', label: 'Iscrizione e pagamento' },
  { name: 'stato', label: 'Stato', type: 'select', options: STATI_PERSONA },
  { name: 'tipo_pagamento', label: 'Tipo di pagamento', type: 'select', options: TIPI_PAGAMENTO },
  { name: 'data_inizio', label: 'Inizio (da qui partono le rate)', type: 'date', required: true },
  { name: 'data_fine', label: 'Fine (vuoto = in corso)', type: 'date' },
  { name: 'importo', label: 'Importo della rata (€)', type: 'number', step: '0.01' },
  { name: 'metodo_pagamento', label: 'Metodo di pagamento abituale', type: 'select', options: METODI },
  { name: 'note', label: 'Note', type: 'textarea' }
];

function editPersona(cliente, persona, onDone) {
  openForm({
    title: persona ? `Modifica ${persona.nome} ${persona.cognome}` : 'Nuova persona',
    fields: PERSONA_FIELDS,
    values: persona || { stato: 'attivo', tipo_pagamento: 'mensile', data_inizio: new Date().toISOString().slice(0, 10) },
    onSubmit: async (data) => {
      const saved = await api.persone.save(cliente.id, persona?.id, data);
      toast(persona ? 'Dati aggiornati' : 'Persona aggiunta');
      onDone(saved);
    }
  });
}

/** Etichetta del periodo coperto da una rata: "novembre 2026" o "ottobre – dicembre 2026". */
function periodoLabel(r) {
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
let cercaTimer;

async function renderElencoPersone(cliente, el) {
  const persone = await safe(() => api.persone.list(cliente.id));
  const q = filtroPersone.testo.toLowerCase();
  const lista = persone.filter((p) => {
    if (q && !`${p.nome} ${p.cognome} ${p.telefono || ''} ${p.email || ''}`.toLowerCase().includes(q)) return false;
    if (filtroPersone.vista === 'attivi') return p.stato !== 'cessato';
    if (filtroPersone.vista === 'ritardo') return p.situazione.inRitardo.length > 0;
    if (filtroPersone.vista === 'cessati') return p.stato === 'cessato';
    return true;
  });
  const nRitardo = persone.filter((p) => p.situazione.inRitardo.length).length;

  el.innerHTML = `
    <div class="toolbar">
      <input id="f-persone" class="search-input" placeholder="Cerca per nome, telefono, email…" value="${esc(filtroPersone.testo)}">
      <div class="segmented">
        ${[['attivi', 'Attivi'], ['ritardo', `In ritardo${nRitardo ? ` (${nRitardo})` : ''}`], ['cessati', 'Cessati'], ['tutti', 'Tutti']]
          .map(([k, l]) => `<button class="${filtroPersone.vista === k ? 'active' : ''} ${k === 'ritardo' && nRitardo ? 'alert' : ''}" data-vista="${k}">${l}</button>`)
          .join('')}
      </div>
      <div class="spacer"></div>
      <button class="btn primary" id="btn-add-persona">＋ Nuova persona</button>
    </div>
    <div class="table-wrap"><table class="clickable">
      <thead><tr><th>Nome</th><th>Telefono</th><th>Pagamento</th><th>Situazione rate</th><th>Ultimo appuntamento</th><th>Prossimo</th></tr></thead>
      <tbody>${
        lista.length
          ? lista
              .map(
                (p) => `<tr data-persona-row="${p.id}" class="${p.situazione.inRitardo.length ? 'row-late' : ''} ${p.stato === 'cessato' ? 'row-muted' : ''}">
                  <td><strong>${esc(p.cognome)} ${esc(p.nome)}</strong>
                    ${p.stato !== 'attivo' ? ` <span class="badge annullata">${esc(label(STATI_PERSONA, p.stato))}</span>` : ''}
                    ${p.situazione.certificatoScaduto ? ' <span class="badge late" title="Certificato medico scaduto">Certificato scaduto</span>' : ''}</td>
                  <td>${esc(p.telefono)}</td>
                  <td>${esc(tipoBreve(p.tipo_pagamento))}${p.importo ? ` · ${eur(p.importo)}` : ''}</td>
                  <td>${badgePagamenti(p.situazione)}${p.situazione.ricevuteMancanti ? ` <span class="badge warn" title="Pagamenti senza ricevuta">${p.situazione.ricevuteMancanti} senza ricevuta</span>` : ''}</td>
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
  el.querySelectorAll('[data-persona-row]').forEach((tr) => (tr.onclick = () => apriPersona(Number(tr.dataset.personaRow))));
}

function apriPersona(personaId) {
  go({ name: 'cliente', id: route.id, tab: 'anagrafica', personaId });
}

// ---------- Scheda persona ----------------------------------------------------

async function renderPersona(cliente, el, personaId) {
  const d = await safe(() => api.persone.get(cliente.id, personaId));
  const p = d.persona;
  const s = d.pagamenti;
  const refresh = () => renderPersona(cliente, el, personaId);
  const now = new Date();
  const prossimi = d.appuntamenti.filter((a) => new Date(a.inizio) > now).reverse();
  const storico = d.appuntamenti.filter((a) => new Date(a.inizio) <= now);

  const info = [
    ['Telefono', p.telefono], ['Email', p.email], ['Data di nascita', p.data_nascita && `${fmtDate(p.data_nascita)} (${eta(p.data_nascita)} anni)`],
    ['Codice fiscale', p.codice_fiscale], ['Indirizzo', p.indirizzo], ['Contatto di emergenza', p.contatto_emergenza],
    ['Obiettivo', p.obiettivo], ['Livello', p.livello], ['Altezza', p.altezza_cm && `${p.altezza_cm} cm`], ['Peso iniziale', p.peso_kg && `${p.peso_kg} kg`],
    ['Certificato medico', p.certificato_scadenza && `scade il ${fmtDate(p.certificato_scadenza)}${d.certificatoScaduto ? ' — SCADUTO' : ''}`],
    ['Iscritto dal', fmtDate(p.data_inizio)], ['Fine', p.data_fine && fmtDate(p.data_fine)],
    ['Pagamento', `${tipoBreve(p.tipo_pagamento)}${p.importo ? ` · ${eur(p.importo)}` : ''}${p.metodo_pagamento ? ` · ${label(METODI, p.metodo_pagamento)}` : ''}`]
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
        <h3>Rate e pagamenti</h3>
        <button class="btn small" id="btn-extra">＋ Pagamento ${MESI_TIPO[p.tipo_pagamento] ? 'extra' : ''}</button>
      </div>
      ${
        !MESI_TIPO[p.tipo_pagamento]
          ? '<p class="muted">Con questo tipo di pagamento non ci sono scadenze automatiche: registra i pagamenti man mano.</p>'
          : ''
      }
      ${tabellaRate(s.rate)}
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
          : '<div class="muted empty-box">Nessun documento. Qui puoi caricare certificato medico, consenso privacy, ricevute…</div>'
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
  $('#btn-add-doc').onclick = () => caricaDocumento(cliente, p, refresh);

  collegaAzioniAppuntamenti(el, cliente, d.appuntamenti, refresh);

  el.querySelectorAll('[data-rata-paga]').forEach(
    (b) => (b.onclick = () => registraPagamento(cliente, p, s.rate[Number(b.dataset.rataPaga)], refresh))
  );
  el.querySelectorAll('[data-rata-esente]').forEach(
    (b) =>
      (b.onclick = async () => {
        const r = s.rate[Number(b.dataset.rataEsente)];
        const motivo = prompt(`Segnare ${periodoLabel(r)} come non dovuta? Motivo (facoltativo):`, 'Sospensione');
        if (motivo === null) return;
        await safe(() => api.pagamenti.save(cliente.id, { persona_id: p.id, periodo: r.periodo, esente: true, importo: 0, note: motivo }));
        refresh();
      })
  );
  el.querySelectorAll('[data-rata-edit]').forEach(
    (b) => (b.onclick = () => registraPagamento(cliente, p, s.rate[Number(b.dataset.rataEdit)], refresh))
  );
  el.querySelectorAll('[data-rata-del]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Annullare questo pagamento? La rata tornerà da pagare.')) return;
        await safe(() => api.records.remove(cliente.id, 'pagamenti', Number(b.dataset.rataDel)));
        refresh();
      })
  );
  el.querySelectorAll('[data-rata-upload]').forEach(
    (b) => (b.onclick = () => registraPagamento(cliente, p, s.rate[Number(b.dataset.rataUpload)], refresh, true))
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

function tabellaRate(rate) {
  if (!rate.length) return '<div class="muted empty-box">Nessuna rata.</div>';
  const statoBadge = {
    pagata: '<span class="badge pagata">Pagata</span>',
    esente: '<span class="badge annullata">Non dovuta</span>',
    da_pagare: '<span class="badge da_pagare">Da pagare</span>',
    in_ritardo: '<span class="badge late">⚠ In ritardo</span>'
  };
  return `<div class="table-wrap"><table>
    <thead><tr><th>Periodo</th><th>Scadenza</th><th class="num">Importo</th><th>Stato</th><th>Pagata il</th><th>Ricevuta</th><th></th></tr></thead>
    <tbody>${rate
      .map((r, i) => {
        const pag = r.pagamento;
        let ricevuta = '';
        if (pag?.documento_id) ricevuta = `<a class="link" data-doc-open="${pag.documento_id}">📄 Apri</a>`;
        else if (r.ricevuta_mancante) ricevuta = `<button class="btn small warn-btn" data-rata-upload="${i}">Carica ricevuta</button>`;
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
    ? [{ name: 'ricevuta', label: 'Ricevuta (PDF o foto)', type: 'file', accept: ACCEPT_DOC, required: true }]
    : [
        ...(rata?.periodo ? [] : [{ name: 'periodo', label: 'Mese di riferimento (facoltativo)', type: 'month' }]),
        { name: 'importo', label: 'Importo pagato (€)', type: 'number', step: '0.01', required: true },
        { name: 'pagato_il', label: 'Pagato il', type: 'date', required: true },
        { name: 'metodo', label: 'Metodo', type: 'select', options: METODI },
        { name: 'ricevuta', label: pag?.documento_id ? 'Sostituisci ricevuta (facoltativo)' : 'Ricevuta (PDF o foto)', type: 'file', accept: ACCEPT_DOC },
        { name: 'note', label: 'Note', type: 'textarea' }
      ];
  openForm({
    title: soloRicevuta
      ? `Ricevuta · ${periodoLabel(rata)}`
      : `${pag ? 'Modifica pagamento' : 'Registra pagamento'}${rata?.periodo ? ` · ${periodoLabel(rata)}` : ''}`,
    fields,
    values: pag
      ? { ...pag, periodo: pag.periodo?.slice(0, 7) }
      : { importo: rata?.importo ?? persona.importo ?? '', pagato_il: oggi, metodo: persona.metodo_pagamento || '' },
    onSubmit: async (data) => {
      const file = await fileDaInput(data.ricevuta);
      const periodo = rata?.periodo || (data.periodo ? `${data.periodo}-01` : null);
      const payload = soloRicevuta
        ? { ...pag }
        : { ...(pag || {}), persona_id: persona.id, periodo, importo: data.importo, pagato_il: data.pagato_il, metodo: data.metodo, note: data.note, esente: false };
      await api.pagamenti.save(cliente.id, { ...payload, persona_id: persona.id }, file);
      toast(soloRicevuta ? 'Ricevuta caricata' : 'Pagamento registrato');
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
  descrizione: 'Persone, abbonamenti, rate e ricevute',
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

