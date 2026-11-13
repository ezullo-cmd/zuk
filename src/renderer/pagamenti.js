/* global api, SECTIONS, $, esc, eur, toast, safe, fmtDate, fmtDateTime, periodoLabel, registraPagamento, label, TIPI_PERCORSO, METODI */
'use strict';

// ---------- Sezione "Pagamenti e rate": registro di tutte le rate --------------

let filtroRate = { testo: '', vista: 'aperte', mese: '' };

const giorniTra = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

SECTIONS.pagamenti = {
  label: 'Pagamenti e rate',
  descrizione: 'Rate pagate, contabili PDF e ritardi',
  render: async function renderPagamenti(cliente, el) {
    const [{ oggi, rate }, prom] = await Promise.all([
      safe(() => api.rate.list(cliente.id)),
      api.promemoria.list(cliente.id).catch(() => [])
    ]);
    const promPerRata = new Map(prom.map((x) => [x.chiave, x]));
    const chiaveRata = (r) => (r.percorso_id ? `perc-${r.percorso_id}-${r.numero_rata}` : `abb-${r.persona.id}-${r.periodo}`);
    const meseCorrente = oggi.slice(0, 7);

    // riepilogo
    const ritardo = rate.filter((r) => r.stato === 'in_ritardo');
    const scadonoMese = rate.filter((r) => r.stato === 'da_pagare' && r.scadenza?.slice(0, 7) === meseCorrente);
    const incassatiMese = rate.filter((r) => r.stato === 'pagata' && r.pagamento?.pagato_il?.slice(0, 7) === meseCorrente);
    const senzaFattura = rate.filter((r) => r.ricevuta_mancante);
    const somma = (l) => l.reduce((s, r) => s + (Number(r.importo) || 0), 0);

    // filtri
    const q = filtroRate.testo.toLowerCase();
    let lista = rate.filter((r) => !q || `${r.persona.nome} ${r.persona.cognome}`.toLowerCase().includes(q));
    const viste = {
      aperte: (r) => r.stato === 'in_ritardo' || r.stato === 'da_pagare',
      ritardo: (r) => r.stato === 'in_ritardo',
      pagate: (r) => r.stato === 'pagata' || r.stato === 'esente',
      senza_fattura: (r) => r.ricevuta_mancante,
      tutte: () => true
    };
    lista = lista.filter(viste[filtroRate.vista]);
    if (filtroRate.mese)
      lista = lista.filter((r) => (r.scadenza || r.pagamento?.pagato_il || '').slice(0, 7) === filtroRate.mese);
    const ordine = { in_ritardo: 0, da_pagare: 1, pagata: 2, esente: 3 };
    lista.sort((a, b) =>
      ordine[a.stato] - ordine[b.stato] ||
      (a.stato === 'pagata' || a.stato === 'esente'
        ? String(b.pagamento?.pagato_il).localeCompare(String(a.pagamento?.pagato_il))
        : String(a.scadenza).localeCompare(String(b.scadenza)))
    );

    el.innerHTML = `
      <div class="cards">
        <div class="card ${ritardo.length ? 'card-alert' : ''}"><div class="label">In ritardo</div>
          <div class="value">${eur(somma(ritardo))}</div><div class="muted">${ritardo.length} rate</div></div>
        <div class="card"><div class="label">Scadono questo mese</div>
          <div class="value">${eur(somma(scadonoMese))}</div><div class="muted">${scadonoMese.length} rate</div></div>
        <div class="card"><div class="label">Incassato questo mese</div>
          <div class="value">${eur(somma(incassatiMese))}</div><div class="muted">${incassatiMese.length} rate</div></div>
        <div class="card ${senzaFattura.length ? 'card-warn' : ''}"><div class="label">Pagate senza contabile</div>
          <div class="value">${senzaFattura.length}</div><div class="muted">PDF da caricare</div></div>
      </div>

      ${pannelloPromemoria(cliente, prom)}

      <div class="toolbar">
        <input id="f-rate" class="search-input" placeholder="Cerca persona…" value="${esc(filtroRate.testo)}">
        <div class="segmented">
          ${[
            ['aperte', 'Da incassare'],
            ['ritardo', `In ritardo${ritardo.length ? ` (${ritardo.length})` : ''}`],
            ['pagate', 'Pagate'],
            ['senza_fattura', `Senza contabile${senzaFattura.length ? ` (${senzaFattura.length})` : ''}`],
            ['tutte', 'Tutte']
          ]
            .map(([k, l]) => `<button data-vista="${k}" class="${filtroRate.vista === k ? 'active' : ''} ${k === 'ritardo' && ritardo.length ? 'alert' : ''}">${l}</button>`)
            .join('')}
        </div>
        <label class="inline">Mese <input type="month" id="f-mese" value="${esc(filtroRate.mese)}"></label>
        ${filtroRate.mese ? '<button class="btn small ghost" id="f-mese-x">✕</button>' : ''}
      </div>

      <div class="table-wrap"><table>
        <thead><tr><th>Persona</th><th>Percorso</th><th>Rata</th><th>Scadenza</th><th class="num">Importo</th><th>Stato</th><th>Pagata il</th><th>Contabile</th><th></th></tr></thead>
        <tbody>${
          lista.length
            ? lista
                .map((r, i) => {
                  const pag = r.pagamento;
                  const ritardoGg = r.stato === 'in_ritardo' ? giorniTra(r.scadenza, oggi) : 0;
                  let stato = {
                    pagata: '<span class="badge pagata">Pagata</span>',
                    esente: '<span class="badge annullata">Non dovuta</span>',
                    da_pagare: `<span class="badge da_pagare">Da pagare</span>${r.scadenza ? `<div class="muted small">tra ${giorniTra(oggi, r.scadenza)} gg</div>` : ''}`,
                    in_ritardo: `<span class="badge late">⚠ In ritardo</span><div class="late-days">${ritardoGg} ${ritardoGg === 1 ? 'giorno' : 'giorni'}</div>`
                  }[r.stato];
                  const pr = promPerRata.get(chiaveRata(r));
                  if (pr && r.stato !== 'pagata' && r.stato !== 'esente')
                    stato += `<div class="small ${pr.stato === 'errore' ? 'late-days' : 'muted'}">🔔 ${
                      pr.stato === 'inviato' ? `promemoria inviato il ${fmtDate(pr.inviato_il)}` : pr.stato === 'errore' ? 'promemoria non inviato' : 'promemoria da inviare'
                    }</div>`;
                  let fattura = '';
                  if (pag?.documento_id) fattura = `<a class="link" data-doc-open="${pag.documento_id}">📄 Apri</a>`;
                  else if (r.ricevuta_mancante) fattura = `<button class="btn small warn-btn" data-r-upload="${i}">Carica contabile</button>`;
                  return `<tr class="${r.stato === 'in_ritardo' ? 'row-late' : ''} ${r.persona.stato === 'cessato' ? 'row-muted' : ''}">
                    <td><a class="link" data-open-persona="${r.persona.id}"><strong>${esc(r.persona.cognome)} ${esc(r.persona.nome)}</strong></a></td>
                    <td>${r.tipo_percorso ? esc(label(TIPI_PERCORSO, r.tipo_percorso)) : '<span class="muted">—</span>'}</td>
                    <td>${esc(periodoLabel(r))}${pag?.note ? `<div class="muted small">${esc(pag.note)}</div>` : ''}</td>
                    <td>${r.scadenza ? fmtDate(r.scadenza) : '—'}</td>
                    <td class="num">${r.importo !== null && r.importo !== undefined ? eur(r.importo) : '—'}</td>
                    <td>${stato}</td>
                    <td>${pag && !pag.esente ? `${fmtDate(pag.pagato_il)}${pag.metodo ? `<div class="muted small">${esc(label(METODI, pag.metodo))}</div>` : ''}` : ''}</td>
                    <td>${fattura}</td>
                    <td class="row-actions">${
                      pag
                        ? `<button class="btn small" data-r-edit="${i}">Modifica</button><button class="btn small danger" data-r-del="${pag.id}">Annulla</button>`
                        : `<button class="btn small primary" data-r-paga="${i}">Registra pagamento</button>`
                    }</td>
                  </tr>`;
                })
                .join('')
            : `<tr><td class="empty-row" colspan="9">${rate.length ? 'Nessuna rata con questi filtri.' : 'Nessuna rata: crea i percorsi delle persone nell’Anagrafica.'}</td></tr>`
        }</tbody>
        ${
          lista.length
            ? `<tfoot><tr><td colspan="4">Totale (${lista.length} rate)</td><td class="num">${eur(somma(lista))}</td><td colspan="4"></td></tr></tfoot>`
            : ''
        }
      </table></div>`;

    const refresh = () => renderPagamenti(cliente, el);
    let t;
    const search = $('#f-rate');
    search.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        filtroRate.testo = search.value;
        refresh().then(() => { const s = $('#f-rate'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
      }, 300);
    };
    el.querySelectorAll('[data-vista]').forEach((b) => (b.onclick = () => { filtroRate.vista = b.dataset.vista; refresh(); }));
    $('#f-mese').onchange = (e) => { filtroRate.mese = e.target.value; refresh(); };
    if ($('#f-mese-x')) $('#f-mese-x').onclick = () => { filtroRate.mese = ''; refresh(); };

    el.querySelectorAll('[data-r-paga]').forEach((b) => (b.onclick = () => {
      const r = lista[Number(b.dataset.rPaga)];
      registraPagamento(cliente, r.persona, r, refresh);
    }));
    el.querySelectorAll('[data-r-edit]').forEach((b) => (b.onclick = () => {
      const r = lista[Number(b.dataset.rEdit)];
      registraPagamento(cliente, r.persona, r, refresh);
    }));
    el.querySelectorAll('[data-r-upload]').forEach((b) => (b.onclick = () => {
      const r = lista[Number(b.dataset.rUpload)];
      registraPagamento(cliente, r.persona, r, refresh, true);
    }));
    el.querySelectorAll('[data-r-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Annullare questo pagamento? La rata tornerà da pagare e la contabile resterà tra i documenti della persona.')) return;
      await safe(() => api.records.remove(cliente.id, 'pagamenti', Number(b.dataset.rDel)));
      toast('Pagamento annullato');
      aggiornaRitardi();
      refresh();
    }));
    collegaPromemoria(el, cliente, refresh);
    el.querySelectorAll('[data-doc-open]').forEach((a) => (a.onclick = () => safe(() => api.documenti.open(cliente.id, Number(a.dataset.docOpen)))));
  }
};

// ---------- Promemoria rate ---------------------------------------------------

function pannelloPromemoria(cliente, prom) {
  if (!cliente.promemoria_attivi)
    return `<div class="panel promemoria-panel off"><strong>🔔 Promemoria rate disattivati.</strong>
      <span class="muted">Attivali da “Modifica” in alto: verrà inviato un messaggio 5 giorni lavorativi prima di ogni scadenza.</span></div>`;
  const aperti = prom.filter((x) => x.stato !== 'inviato');
  const inviati = prom.filter((x) => x.stato === 'inviato').slice(0, 8);
  const riga = (x) => `<div class="prom-row ${x.stato}">
      <div class="prom-icon">${x.canale === 'email' ? '✉️' : '💬'}</div>
      <div class="prom-body">
        <div><a class="link" data-open-persona="${x.persona_id}"><strong>${esc(x.cognome)} ${esc(x.nome)}</strong></a>
          <span class="muted">· rata in scadenza il ${fmtDate(x.scadenza)} · ${x.canale === 'email' ? 'email' : 'WhatsApp'} ${esc(x.destinatario || '')}</span></div>
        <div class="prom-testo">${esc(x.testo)}</div>
        ${x.stato === 'errore' ? `<div class="late-days">Errore: ${esc(x.errore)}</div>` : ''}
        ${x.stato === 'inviato' ? `<div class="muted small">Inviato il ${fmtDateTime(x.inviato_il)}</div>` : ''}
      </div>
      <div class="prom-actions">${
        x.stato === 'inviato'
          ? ''
          : x.canale === 'whatsapp'
            ? `<button class="btn small wa-btn" data-prom-wa="${x.id}">Invia su WhatsApp</button>
               <button class="btn small" data-prom-ok="${x.id}">Segna come inviato</button>`
            : `<button class="btn small primary" data-prom-retry="${x.id}">Riprova</button>
               <button class="btn small" data-prom-ok="${x.id}">Segna come inviato</button>`
      }<button class="btn small ghost" data-prom-del="${x.id}" title="Rimuovi">✕</button></div>
    </div>`;
  return `<div class="panel promemoria-panel">
    <div class="panel-head">
      <h3>🔔 Promemoria rate ${aperti.length ? `<span class="count-late">${aperti.length}</span>` : ''}</h3>
      <button class="btn small" id="btn-prom-check">Controlla ora</button>
    </div>
    ${aperti.length ? aperti.map(riga).join('') : '<div class="muted">Nessun promemoria da inviare. Partono da soli 5 giorni lavorativi prima di ogni scadenza.</div>'}
    ${inviati.length ? `<details><summary class="muted">Inviati di recente (${inviati.length})</summary>${inviati.map(riga).join('')}</details>` : ''}
  </div>`;
}

function collegaPromemoria(el, cliente, refresh) {
  const btn = el.querySelector('#btn-prom-check');
  if (btn)
    btn.onclick = async () => {
      btn.disabled = true;
      const e = await safe(() => api.promemoria.check()).finally(() => (btn.disabled = false));
      toast(e && (e.email || e.whatsapp || e.errori) ? `Email inviate: ${e.email} · WhatsApp da inviare: ${e.whatsapp} · Errori: ${e.errori}` : 'Nessun nuovo promemoria');
      refresh();
    };
  el.querySelectorAll('[data-prom-wa]').forEach((b) => (b.onclick = () => safe(() => api.promemoria.whatsapp(cliente.id, Number(b.dataset.promWa)))));
  el.querySelectorAll('[data-prom-ok]').forEach((b) => (b.onclick = async () => {
    await safe(() => api.promemoria.segnaInviato(cliente.id, Number(b.dataset.promOk)));
    refresh();
  }));
  el.querySelectorAll('[data-prom-retry]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      await api.promemoria.riprova(cliente.id, Number(b.dataset.promRetry));
      toast('Email inviata');
    } catch (e) {
      toast('Invio non riuscito: ' + e.message, true);
    }
    refresh();
  }));
  el.querySelectorAll('[data-prom-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Rimuovere questo promemoria? Non verrà ricreato per la stessa rata.')) return;
    // lo segniamo come inviato così il controllo automatico non lo ricrea
    await safe(() => api.promemoria.segnaInviato(cliente.id, Number(b.dataset.promDel)));
    refresh();
  }));
}
