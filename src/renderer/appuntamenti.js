/* global api, SECTIONS, $, esc, toast, safe, openForm, fmtDateTime, toLocalInput */
'use strict';

// ---------- Appuntamenti collegati all'anagrafica ----------------------------

const STATI_APP = [
  ['programmato', 'Programmato'],
  ['svolto', 'Svolto'],
  ['assente', 'Assente'],
  ['annullato', 'Annullato']
];
const DURATE = [['30', '30 min'], ['45', '45 min'], ['60', '1 ora'], ['90', '1 ora e 30'], ['120', '2 ore']];

const nomePersona = (p) => `${p.cognome} ${p.nome}`;
const durataMin = (a) => (a.fine ? Math.round((new Date(a.fine) - new Date(a.inizio)) / 60000) : null);

// un appuntamento passato ancora "programmato" si considera svolto
function statoEffettivo(a) {
  if (a.stato === 'programmato' && new Date(a.inizio) <= new Date()) return 'svolto';
  return a.stato;
}
const badgeStato = (a) => {
  const st = statoEffettivo(a);
  return `<span class="badge app-${st}">${esc((STATI_APP.find(([k]) => k === st) || [, st])[1])}</span>`;
};

/** Apre il modulo per creare/modificare un appuntamento. */
async function editAppuntamento(cliente, row, { personaId, onDone } = {}) {
  let persone = [];
  try {
    persone = (await api.persone.list(cliente.id)).filter((p) => p.stato !== 'cessato' || p.id === (row?.persona_id ?? personaId));
  } catch { /* anagrafica vuota */ }

  const fields = [];
  if (persone.length)
    fields.push({
      name: 'persona_id', label: 'Persona', type: 'select', full: true,
      options: [['', '— Nessuna —'], ...persone.map((p) => [p.id, nomePersona(p)])]
    });
  fields.push(
    { name: 'titolo', label: 'Tipo / descrizione', full: true, placeholder: 'Es. Allenamento, Valutazione…' },
    { name: 'inizio', label: 'Data e ora', type: 'datetime-local', required: true },
    { name: 'durata', label: 'Durata', type: 'select', options: DURATE },
    { name: 'luogo', label: 'Luogo' },
    { name: 'stato', label: 'Stato', type: 'select', options: STATI_APP }
  );
  if (!row)
    fields.push(
      {
        name: 'ripeti', label: 'Ripeti', type: 'select',
        options: [['0', 'Non ripetere'], ['7', 'Ogni settimana'], ['14', 'Ogni 2 settimane'], ['1', 'Ogni giorno']]
      },
      { name: 'volte', label: 'Quante volte in totale', type: 'number', value: 1 }
    );
  fields.push({ name: 'note', label: 'Note', type: 'textarea' });

  const values = row
    ? { ...row, inizio: toLocalInput(row.inizio), durata: String(durataMin(row) || 60) }
    : { persona_id: personaId || '', titolo: 'Allenamento', durata: '60', stato: 'programmato', ripeti: '0', volte: 1 };

  openForm({
    title: row ? 'Modifica appuntamento' : 'Nuovo appuntamento',
    fields,
    values,
    onSubmit: async (d) => {
      const base = {
        persona_id: d.persona_id ?? null,
        titolo: d.titolo,
        luogo: d.luogo,
        stato: d.stato,
        note: d.note
      };
      const start = new Date(d.inizio);
      const durata = Number(d.durata) * 60000;
      if (row) {
        await api.records.update(cliente.id, 'appuntamenti', row.id, {
          ...base, inizio: start.toISOString(), fine: new Date(+start + durata).toISOString()
        });
      } else {
        const passo = Number(d.ripeti);
        const volte = passo ? Math.min(Math.max(Number(d.volte) || 1, 1), 104) : 1;
        for (let i = 0; i < volte; i++) {
          const s = new Date(start);
          s.setDate(s.getDate() + passo * i);
          await api.records.create(cliente.id, 'appuntamenti', {
            ...base, inizio: s.toISOString(), fine: new Date(+s + durata).toISOString()
          });
        }
        toast(volte > 1 ? `${volte} appuntamenti creati` : 'Appuntamento creato');
      }
      onDone && onDone();
    }
  });
}

async function cambiaStatoAppuntamento(cliente, id, stato, onDone) {
  await safe(() => api.records.update(cliente.id, 'appuntamenti', id, { stato }));
  onDone && onDone();
}

/** Tabella appuntamenti riutilizzabile (scheda Appuntamenti e scheda persona). */
function tabellaAppuntamenti(rows, { mostraPersona = true, vuoto = 'Nessun appuntamento.' } = {}) {
  if (!rows.length) return `<div class="muted empty-box">${vuoto}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Quando</th>${mostraPersona ? '<th>Persona</th>' : ''}<th>Tipo</th><th>Durata</th><th>Stato</th><th>Note</th><th></th></tr></thead>
    <tbody>${rows
      .map((a) => {
        const futuro = new Date(a.inizio) > new Date();
        return `<tr class="${a.stato === 'annullato' ? 'row-muted' : ''}">
          <td>${fmtDateTime(a.inizio)}</td>
          ${mostraPersona ? `<td>${a.persona_id ? `<a class="link" data-open-persona="${a.persona_id}">${esc(a.persona_nome || '')}</a>` : '<span class="muted">—</span>'}</td>` : ''}
          <td>${esc(a.titolo)}</td>
          <td>${durataMin(a) ? durataMin(a) + ' min' : ''}</td>
          <td>${badgeStato(a)}</td>
          <td class="note-cell">${esc(a.note)}</td>
          <td class="row-actions">
            ${!futuro && a.stato === 'programmato' ? `<button class="btn small" data-app-stato="assente" data-app="${a.id}" title="Segna assente">Assente</button>` : ''}
            ${futuro && a.stato === 'programmato' ? `<button class="btn small" data-app-stato="annullato" data-app="${a.id}">Annulla</button>` : ''}
            <button class="btn small" data-app-edit="${a.id}">Modifica</button>
            <button class="btn small danger" data-app-del="${a.id}">Elimina</button>
          </td></tr>`;
      })
      .join('')}</tbody></table></div>`;
}

function collegaAzioniAppuntamenti(root, cliente, rows, refresh) {
  root.querySelectorAll('[data-app-edit]').forEach(
    (b) => (b.onclick = () => editAppuntamento(cliente, rows.find((r) => r.id === Number(b.dataset.appEdit)), { onDone: refresh }))
  );
  root.querySelectorAll('[data-app-stato]').forEach(
    (b) => (b.onclick = () => cambiaStatoAppuntamento(cliente, Number(b.dataset.app), b.dataset.appStato, refresh))
  );
  root.querySelectorAll('[data-app-del]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Eliminare questo appuntamento?')) return;
        await safe(() => api.records.remove(cliente.id, 'appuntamenti', Number(b.dataset.appDel)));
        toast('Eliminato');
        refresh();
      })
  );
}

/** Riquadro con le statistiche di frequenza di una persona. */
function boxStatistiche(st) {
  const fmtGiorni = (n) => (n === null ? '—' : n === 0 ? 'oggi' : n === 1 ? 'ieri' : `${n} giorni fa`);
  return `<div class="stats">
    <div class="stat"><span>Svolti</span><strong>${st.svolti}</strong></div>
    <div class="stat"><span>Viene in media</span><strong>${st.mediaGiorni === null ? '—' : `ogni ${String(st.mediaGiorni).replace('.', ',')} gg`}</strong></div>
    <div class="stat"><span>Ultime 4 settimane</span><strong>${String(st.perSettimana).replace('.', ',')} / sett.</strong></div>
    <div class="stat"><span>Ultimo</span><strong>${fmtGiorni(st.giorniDallUltimo)}</strong></div>
    <div class="stat"><span>Prossimo</span><strong>${st.prossimo ? fmtDateTime(st.prossimo) : '—'}</strong></div>
    <div class="stat"><span>Assenze</span><strong>${st.assenze}</strong></div>
  </div>`;
}

// ---------- Scheda "Appuntamenti" ------------------------------------------
let filtroApp = { persona: '', vista: 'prossimi' };

SECTIONS.appuntamenti.render = async function renderAppuntamenti(cliente, el) {
  const [rows, persone] = await Promise.all([
    safe(() => api.records.list(cliente.id, 'appuntamenti')),
    api.persone.list(cliente.id).catch(() => [])
  ]);
  if (filtroApp.persona && !persone.some((p) => String(p.id) === filtroApp.persona)) filtroApp.persona = '';

  const now = new Date();
  let lista = rows.filter((a) => !filtroApp.persona || String(a.persona_id) === filtroApp.persona);
  if (filtroApp.vista === 'prossimi') lista = lista.filter((a) => new Date(a.inizio) > now).reverse();
  if (filtroApp.vista === 'storico') lista = lista.filter((a) => new Date(a.inizio) <= now);

  const stats = filtroApp.persona ? (await safe(() => api.persone.get(cliente.id, Number(filtroApp.persona)))).statistiche : null;

  el.innerHTML = `
    <div class="toolbar">
      ${
        persone.length
          ? `<select id="f-persona"><option value="">Tutte le persone</option>${persone
              .map((p) => `<option value="${p.id}" ${String(p.id) === filtroApp.persona ? 'selected' : ''}>${esc(nomePersona(p))}</option>`)
              .join('')}</select>`
          : ''
      }
      <div class="segmented">
        ${[['prossimi', 'Prossimi'], ['storico', 'Storico'], ['tutti', 'Tutti']]
          .map(([k, l]) => `<button class="${filtroApp.vista === k ? 'active' : ''}" data-vista="${k}">${l}</button>`)
          .join('')}
      </div>
      <div class="spacer"></div>
      <button class="btn primary" id="btn-add-app">＋ Nuovo appuntamento</button>
    </div>
    ${stats ? boxStatistiche(stats) : ''}
    ${tabellaAppuntamenti(lista, {
      vuoto: filtroApp.vista === 'prossimi' ? 'Nessun appuntamento in programma.' : 'Nessun appuntamento.'
    })}`;

  const refresh = () => renderAppuntamenti(cliente, el);
  const sel = $('#f-persona');
  if (sel) sel.onchange = () => { filtroApp.persona = sel.value; refresh(); };
  el.querySelectorAll('[data-vista]').forEach((b) => (b.onclick = () => { filtroApp.vista = b.dataset.vista; refresh(); }));
  $('#btn-add-app').onclick = () => editAppuntamento(cliente, null, { personaId: filtroApp.persona, onDone: refresh });
  collegaAzioniAppuntamenti(el, cliente, lista, refresh);
};
