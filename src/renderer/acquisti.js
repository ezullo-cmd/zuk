/* global api, SECTIONS, $, esc, eur, toast, safe, openForm, fmtDate, oggiLocale, aggiornaRitardi */
'use strict';

// ---------- Acquisti: ordini ai fornitori con consegna prevista -----------------
// Giallo: mancano 5 giorni o meno alla consegna. Rosso: consegna prevista superata e non ancora arrivato.

const GIORNI_AVVISO = 5;

const giorniA = (da, a) => Math.round((new Date(a + 'T00:00:00') - new Date(da + 'T00:00:00')) / 86400000);

/** Stato di un ordine: consegnato, in_ritardo (rosso), in_arrivo (giallo), in_attesa. */
function statoOrdine(o, oggi = oggiLocale()) {
  if (o.consegnato) return { stato: 'consegnato', giorni: null };
  if (!o.consegna_prevista) return { stato: 'in_attesa', giorni: null };
  const g = giorniA(oggi, o.consegna_prevista);
  if (g < 0) return { stato: 'in_ritardo', giorni: -g };
  if (g <= GIORNI_AVVISO) return { stato: 'in_arrivo', giorni: g };
  return { stato: 'in_attesa', giorni: g };
}

function badgeOrdine(st) {
  switch (st.stato) {
    case 'consegnato': return '<span class="badge ord-ok">✓ Consegnato</span>';
    case 'in_ritardo': return `<span class="badge ord-ritardo">⚠ In ritardo di ${st.giorni} ${st.giorni === 1 ? 'giorno' : 'giorni'}</span>`;
    case 'in_arrivo': return `<span class="badge ord-arrivo">${st.giorni === 0 ? 'Arriva oggi' : st.giorni === 1 ? 'Arriva domani' : `Arriva tra ${st.giorni} giorni`}</span>`;
    default: return `<span class="badge ord-attesa">${st.giorni === null ? 'In attesa' : `Tra ${st.giorni} giorni`}</span>`;
  }
}

const ORDINE_FIELDS = [
  { name: 'descrizione', label: 'Ordine (cosa hai ordinato)', required: true, full: true },
  { name: 'data', label: 'Data dell\'ordine', type: 'date', required: true },
  { name: 'fornitore', label: 'A chi hai ordinato (fornitore)', required: true },
  { name: 'importo', label: 'Costo (€)', type: 'number', step: '0.01', required: true },
  { name: 'consegna_prevista', label: 'Data di consegna prevista', type: 'date' },
  { name: 'consegnato', label: 'Già consegnato', type: 'checkbox' },
  { name: 'data_consegna', label: 'Consegnato il', type: 'date' },
  { name: 'note', label: 'Note', type: 'textarea' }
];

function editOrdine(cliente, ordine, onDone) {
  openForm({
    title: ordine ? 'Modifica ordine' : 'Nuovo ordine',
    fields: ORDINE_FIELDS,
    values: ordine || { data: oggiLocale(), consegnato: false },
    onInput: (v, form) => {
      // la data di consegna serve solo se è spuntato "consegnato"
      const box = form.elements.data_consegna.closest('label');
      box.classList.toggle('hidden', !form.elements.consegnato.checked);
      if (form.elements.consegnato.checked && !form.elements.data_consegna.value) form.elements.data_consegna.value = oggiLocale();
    },
    onSubmit: async (d) => {
      if (d.consegna_prevista && d.data && d.consegna_prevista < d.data)
        throw new Error('La consegna prevista non può essere prima della data dell\'ordine');
      const dati = { ...d, data_consegna: d.consegnato ? d.data_consegna || oggiLocale() : '' };
      if (ordine) await api.records.update(cliente.id, 'acquisti', ordine.id, dati);
      else await api.records.create(cliente.id, 'acquisti', dati);
      toast(ordine ? 'Ordine aggiornato' : 'Ordine aggiunto');
      aggiornaRitardi();
      onDone();
    }
  });
}

let filtroOrdini = { vista: 'da_ricevere', testo: '' };

SECTIONS.acquisti.render = async function renderAcquisti(cliente, el) {
  const ordini = await safe(() => api.records.list(cliente.id, 'acquisti'));
  const oggi = oggiLocale();
  const conStato = ordini.map((o) => ({ ...o, st: statoOrdine(o, oggi) }));
  const per = (s) => conStato.filter((o) => o.st.stato === s);
  const somma = (l) => l.reduce((t, o) => t + (Number(o.importo) || 0), 0);
  const ritardo = per('in_ritardo');
  const arrivo = per('in_arrivo');
  const daRicevere = conStato.filter((o) => !o.consegnato);
  const consegnati = per('consegnato');

  const VISTE = {
    da_ricevere: ['Da ricevere', (o) => !o.consegnato],
    in_ritardo: ['In ritardo', (o) => o.st.stato === 'in_ritardo'],
    in_arrivo: ['In arrivo (5 gg)', (o) => o.st.stato === 'in_arrivo'],
    consegnati: ['Consegnati', (o) => o.consegnato],
    tutti: ['Tutti', () => true]
  };
  const q = filtroOrdini.testo.toLowerCase();
  const ordineVis = { in_ritardo: 0, in_arrivo: 1, in_attesa: 2, consegnato: 3 };
  const lista = conStato
    .filter(VISTE[filtroOrdini.vista][1])
    .filter((o) => !q || `${o.descrizione} ${o.fornitore || ''} ${o.note || ''}`.toLowerCase().includes(q))
    .sort((a, b) =>
      ordineVis[a.st.stato] - ordineVis[b.st.stato] ||
      (a.consegnato
        ? String(b.data_consegna || b.data).localeCompare(String(a.data_consegna || a.data))
        : String(a.consegna_prevista || '9999').localeCompare(String(b.consegna_prevista || '9999')))
    );

  el.innerHTML = `
    <div class="cards">
      <div class="card ${ritardo.length ? 'card-alert' : ''}"><div class="label">In ritardo</div>
        <div class="value">${ritardo.length}</div><div class="muted">${eur(somma(ritardo))}</div></div>
      <div class="card ${arrivo.length ? 'card-yellow' : ''}"><div class="label">In arrivo entro 5 giorni</div>
        <div class="value">${arrivo.length}</div><div class="muted">${eur(somma(arrivo))}</div></div>
      <div class="card"><div class="label">Da ricevere in totale</div>
        <div class="value">${daRicevere.length}</div><div class="muted">${eur(somma(daRicevere))}</div></div>
      <div class="card"><div class="label">Consegnati</div>
        <div class="value">${consegnati.length}</div><div class="muted">${eur(somma(consegnati))}</div></div>
    </div>
    <div class="toolbar">
      <input id="f-ordini" class="search-input" placeholder="Cerca ordine o fornitore…" value="${esc(filtroOrdini.testo)}">
      <div class="segmented">${Object.entries(VISTE)
        .map(([k, [l, fn]]) => {
          const n = conStato.filter(fn).length;
          return `<button data-vista="${k}" class="${filtroOrdini.vista === k ? 'active' : ''} ${k === 'in_ritardo' && n ? 'alert' : ''}">${l} (${n})</button>`;
        })
        .join('')}</div>
      <div class="spacer"></div>
      <button class="btn primary" id="btn-add-ordine">＋ Nuovo ordine</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Ordine</th><th>Fornitore</th><th>Data ordine</th><th class="num">Costo</th><th>Consegna prevista</th><th>Stato</th><th>Consegnato</th><th></th></tr></thead>
      <tbody>${
        lista.length
          ? lista
              .map((o) => `<tr class="${{ in_ritardo: 'row-late', in_arrivo: 'row-arrivo', consegnato: 'row-done' }[o.st.stato] || ''}">
                <td><strong>${esc(o.descrizione)}</strong>${o.note ? `<div class="muted small">${esc(o.note)}</div>` : ''}</td>
                <td>${esc(o.fornitore)}</td>
                <td>${fmtDate(o.data)}</td>
                <td class="num">${eur(o.importo)}</td>
                <td>${o.consegna_prevista ? fmtDate(o.consegna_prevista) : '<span class="muted">—</span>'}</td>
                <td>${badgeOrdine(o.st)}</td>
                <td><label class="check-consegna" title="Spunta quando il materiale è arrivato">
                  <input type="checkbox" data-consegna="${o.id}" ${o.consegnato ? 'checked' : ''}>
                  ${o.consegnato && o.data_consegna ? fmtDate(o.data_consegna) : ''}</label></td>
                <td class="row-actions"><button class="btn small" data-ord-edit="${o.id}">Modifica</button>
                  <button class="btn small danger" data-ord-del="${o.id}">Elimina</button></td>
              </tr>`)
              .join('')
          : `<tr><td class="empty-row" colspan="8">${ordini.length ? 'Nessun ordine con questi filtri.' : 'Nessun ordine. Aggiungi il primo con “Nuovo ordine”.'}</td></tr>`
      }</tbody>
      ${lista.length ? `<tfoot><tr><td colspan="3">Totale (${lista.length})</td><td class="num">${eur(somma(lista))}</td><td colspan="4"></td></tr></tfoot>` : ''}
    </table></div>`;

  const refresh = () => renderAcquisti(cliente, el);
  let t;
  const search = $('#f-ordini');
  search.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      filtroOrdini.testo = search.value;
      refresh().then(() => { const s = $('#f-ordini'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
    }, 250);
  };
  el.querySelectorAll('[data-vista]').forEach((b) => (b.onclick = () => { filtroOrdini.vista = b.dataset.vista; refresh(); }));
  $('#btn-add-ordine').onclick = () => editOrdine(cliente, null, refresh);
  el.querySelectorAll('[data-ord-edit]').forEach((b) => (b.onclick = () => editOrdine(cliente, ordini.find((o) => o.id === Number(b.dataset.ordEdit)), refresh)));
  el.querySelectorAll('[data-ord-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Eliminare questo ordine?')) return;
    await safe(() => api.records.remove(cliente.id, 'acquisti', Number(b.dataset.ordDel)));
    aggiornaRitardi();
    refresh();
  }));
  el.querySelectorAll('[data-consegna]').forEach((c) => (c.onchange = async () => {
    const id = Number(c.dataset.consegna);
    await safe(() => api.records.update(cliente.id, 'acquisti', id, { consegnato: c.checked, data_consegna: c.checked ? oggiLocale() : '' }));
    toast(c.checked ? 'Segnato come consegnato' : 'Tornato tra quelli da ricevere');
    aggiornaRitardi();
    refresh();
  }));
};
