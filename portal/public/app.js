'use strict';

// ---------- Utilità ----------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
const data = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('it-IT') : '');
const dataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');
const mese = (p) => (p ? new Date(p + 'T00:00:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : '');
const TIPI = { personal: 'Personal trainer', nutrizione: 'Nutrizione', personal_nutrizione: 'Personal trainer + Nutrizione' };
const STATI_APP = { programmato: ['Programmato', 'b-blue'], svolto: ['Svolto', 'b-ok'], assente: ['Assente', 'b-late'], annullato: ['Annullato', 'b-grey'] };
const content = $('#content');

let toastT;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), 4000);
}

let silenzioso = false; // al primo caricamento non si mostra "sessione scaduta"

async function api(tipo, params = {}) {
  const q = new URLSearchParams({ tipo, ...params });
  const r = await fetch('/api/dati?' + q, { credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { mostraLogin(silenzioso ? '' : d.errore); throw new Error('non autenticato'); }
  if (!r.ok) throw new Error(d.errore || 'Errore');
  return d;
}

const etichettaRata = (r) => r.etichetta || (r.periodo ? mese(r.periodo) : 'Pagamento');

// ---------- Accesso ----------------------------------------------------------
function mostraLogin(msg) {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  const e = $('#login-errore');
  e.textContent = msg || '';
  e.classList.toggle('hidden', !msg);
}

$('#login-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const btn = f.querySelector('button');
  btn.disabled = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ utente: f.utente.value.trim(), password: f.password.value.trim() })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return mostraLogin(d.errore || 'Accesso non riuscito');
    f.password.value = '';
    avvia();
  } catch {
    mostraLogin('Connessione non riuscita');
  } finally {
    btn.disabled = false;
  }
};

$('#btn-logout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  mostraLogin();
};

// ---------- Applicazione -----------------------------------------------------
let cliente = null;
let vista = { tab: 'home' };
const SEZIONI = [
  ['home', 'Riepilogo'], ['anagrafica', 'Anagrafica'], ['appuntamenti', 'Appuntamenti'],
  ['pagamenti', 'Pagamenti e rate'], ['fatture', 'Fatturazione'], ['acquisti', 'Acquisti']
];

const testoSu = (hex) => {
  const n = parseInt(String(hex || '#2f6fed').slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170 ? '#1d2330' : '#ffffff';
};

async function avvia(primoAvvio = false) {
  silenzioso = primoAvvio;
  try {
    cliente = await api('cliente');
  } catch {
    return;
  } finally {
    silenzioso = false;
  }
  document.documentElement.style.setProperty('--cliente', cliente.colore || '#2f6fed');
  document.documentElement.style.setProperty('--on-cliente', testoSu(cliente.colore));
  $('#cliente-nome').textContent = cliente.nome;
  const logo = $('#cliente-logo');
  if (cliente.logo) {
    logo.innerHTML = '';
    const img = new Image();
    img.src = cliente.logo;
    img.alt = '';
    logo.appendChild(img);
  } else logo.textContent = cliente.nome.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  document.title = `${cliente.nome} · Area clienti`;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  disegnaTabs();
  vai({ tab: 'home' });
}

function disegnaTabs() {
  const visibili = SEZIONI.filter(([k]) => k === 'home' || cliente.sezioni.includes(k));
  $('#tabs').innerHTML = visibili
    .map(([k, l]) => `<button class="tab ${vista.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`)
    .join('');
  $('#tabs').querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => vai({ tab: b.dataset.tab })));
}

const VISTE = {};
async function vai(v) {
  vista = v;
  disegnaTabs();
  content.innerHTML = '<div class="loading">Caricamento…</div>';
  window.scrollTo(0, 0);
  try {
    await VISTE[v.tab](v);
  } catch (e) {
    if (e.message !== 'non autenticato') content.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// click su una persona da qualsiasi vista
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-persona]');
  if (p && cliente.sezioni.includes('anagrafica')) vai({ tab: 'anagrafica', persona: Number(p.dataset.persona) });
});

// ---------- Riepilogo --------------------------------------------------------
VISTE.home = async () => {
  const d = await api('riepilogo');
  let html = `<h2>Riepilogo</h2>`;
  if (d.rate) {
    html += `<div class="cards">
      <div class="card"><div class="label">Persone attive</div><div class="value">${d.persone.attivi}</div></div>
      <div class="card ${d.persone.daRinnovare ? 'warn' : ''}"><div class="label">Da rinnovare</div><div class="value">${d.persone.daRinnovare}</div><div class="sub">entro 30 giorni</div></div>
      <div class="card ${d.rate.ritardo.n ? 'alert' : ''}"><div class="label">Rate in ritardo</div><div class="value">${eur(d.rate.ritardo.importo)}</div><div class="sub">${d.rate.ritardo.n} rate</div></div>
      <div class="card"><div class="label">Scadono questo mese</div><div class="value">${eur(d.rate.scadonoMese.importo)}</div><div class="sub">${d.rate.scadonoMese.n} rate</div></div>
      <div class="card"><div class="label">Incassato questo mese</div><div class="value">${eur(d.rate.incassatoMese.importo)}</div><div class="sub">${d.rate.incassatoMese.n} rate</div></div>
    </div>`;
    if (d.ritardi.length)
      html += `<div class="panel alert"><h3>⚠️ Rate in ritardo</h3><div class="list">${d.ritardi
        .map((r) => `<div class="row click" data-persona="${r.persona.id}"><div class="grow"><strong>${esc(r.persona.cognome)} ${esc(r.persona.nome)}</strong>
          <div class="muted small">${esc(etichettaRata(r))} · scaduta il ${data(r.scadenza)}</div></div><div class="right late-text">${eur(r.importo)}</div></div>`)
        .join('')}</div></div>`;
    if (d.daRinnovare.length)
      html += `<div class="panel"><h3>Percorsi da rinnovare</h3><div class="list">${d.daRinnovare
        .map((p) => `<div class="row click" data-persona="${p.id}"><div class="grow"><strong>${esc(p.cognome)} ${esc(p.nome)}</strong>
          <div class="muted small">${esc(TIPI[p.percorso?.tipo] || '')}</div></div><div class="right"><span class="badge b-warn">termina il ${data(p.percorso?.fine)}</span></div></div>`)
        .join('')}</div></div>`;
  }
  if (d.prossimi)
    html += `<div class="panel"><h3>Prossimi appuntamenti</h3>${d.prossimi.length
      ? `<div class="list">${d.prossimi.map((a) => `<div class="row"><div class="grow"><strong>${esc(a.persona_nome || a.titolo || 'Appuntamento')}</strong>
          ${a.persona_nome && a.titolo ? `<div class="muted small">${esc(a.titolo)}</div>` : ''}</div><div class="right muted">${dataOra(a.inizio)}</div></div>`).join('')}</div>`
      : '<div class="muted">Nessun appuntamento in programma.</div>'}</div>`;
  if (!d.rate && !d.prossimi) html += '<div class="empty">Nessun dato da mostrare.</div>';
  content.innerHTML = html;
};

// ---------- Anagrafica -------------------------------------------------------
const FILTRI = {
  attivi: ['Attivi', (p) => p.situazione.statoPercorso === 'attivo'],
  da_rinnovare: ['Da rinnovare', (p) => p.situazione.daRinnovare],
  terminati: ['Terminati', (p) => p.situazione.statoPercorso === 'terminato'],
  rinnovati: ['Rinnovati', (p) => p.situazione.numRinnovi > 0],
  ritardo: ['In ritardo', (p) => p.situazione.inRitardo.length > 0],
  tutti: ['Tutti', () => true]
};
let filtroP = { f: 'attivi', q: '' };

function badgeRate(s) {
  if (s.inRitardo.length) return `<span class="badge b-late">⚠ ${s.inRitardo.length} in ritardo · ${eur(s.importoInRitardo)}</span>`;
  if (s.prossimaScadenza) return `<span class="badge b-warn">da pagare entro il ${data(s.prossimaScadenza)}</span>`;
  return '<span class="badge b-ok">in regola</span>';
}

VISTE.anagrafica = async (v) => {
  if (v.persona) return schedaPersona(v.persona);
  const persone = await api('persone');
  const disegna = () => {
    const q = filtroP.q.toLowerCase();
    const lista = persone.filter((p) => FILTRI[filtroP.f][1](p) && (!q || `${p.nome} ${p.cognome} ${p.telefono || ''}`.toLowerCase().includes(q)));
    content.innerHTML = `<h2>Anagrafica</h2>
      <div class="toolbar"><input id="cerca" type="search" placeholder="Cerca per nome o telefono…" value="${esc(filtroP.q)}"></div>
      <div class="chips">${Object.entries(FILTRI)
        .map(([k, [l, fn]]) => {
          const n = persone.filter(fn).length;
          return `<button class="chip ${filtroP.f === k ? 'active' : ''} ${k === 'ritardo' && n ? 'alert' : ''}" data-f="${k}">${l} (${n})</button>`;
        })
        .join('')}</div>
      <div class="panel"><div class="list">${
        lista.length
          ? lista
              .map((p) => {
                const pa = p.situazione.percorsoAttuale;
                return `<div class="row click ${p.situazione.inRitardo.length ? 'late' : ''}" data-persona="${p.id}">
                  <div class="grow"><strong>${esc(p.cognome)} ${esc(p.nome)}</strong>
                    ${p.situazione.numRinnovi ? ' <span class="badge b-purple">↻ rinnovato</span>' : ''}
                    <div class="muted small">${pa ? `${esc(TIPI[pa.tipo] || '')} · fino al ${data(pa.fine)}` : 'Nessun percorso'}
                      ${p.situazione.daRinnovare ? ' · <span class="late-text">da rinnovare</span>' : ''}</div></div>
                  <div class="right">${badgeRate(p.situazione)}</div></div>`;
              })
              .join('')
          : '<div class="muted">Nessuna persona.</div>'
      }</div></div>`;
    const c = $('#cerca');
    c.oninput = () => { filtroP.q = c.value; const pos = c.selectionStart; disegna(); const n = $('#cerca'); n.focus(); n.setSelectionRange(pos, pos); };
    content.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filtroP.f = b.dataset.f; disegna(); }));
  };
  disegna();
};

const STATO_RATA = {
  pagata: '<span class="badge b-ok">Pagata</span>',
  esente: '<span class="badge b-grey">Non dovuta</span>',
  da_pagare: '<span class="badge b-warn">Da pagare</span>',
  in_ritardo: '<span class="badge b-late">⚠ In ritardo</span>'
};

function righeRate(rate) {
  if (!rate.length) return '<div class="muted">Nessuna rata.</div>';
  return `<div class="list">${rate
    .map((r) => `<div class="row ${r.stato === 'in_ritardo' ? 'late' : ''}"><div class="grow"><strong>${esc(etichettaRata(r))}</strong>
      <div class="muted small">${r.scadenza ? `scadenza ${data(r.scadenza)}` : ''}${r.pagamento && !r.pagamento.esente ? ` · pagata il ${data(r.pagamento.pagato_il)}` : ''}</div>
      ${r.pagamento?.documento_id ? `<a class="small" href="/api/documento?id=${r.pagamento.documento_id}" target="_blank" rel="noopener">📄 Contabile</a>` : ''}</div>
      <div class="right">${r.importo !== null && r.importo !== undefined ? `<div>${eur(r.importo)}</div>` : ''}${STATO_RATA[r.stato] || ''}</div></div>`)
    .join('')}</div>`;
}

async function schedaPersona(id) {
  const d = await api('persona', { id });
  const p = d.persona;
  const s = d.situazione;
  const st = d.statistiche;
  const info = [
    ['Telefono', p.telefono], ['Email', p.email], ['Data di nascita', data(p.data_nascita)], ['Indirizzo', p.indirizzo],
    ['Obiettivo', p.obiettivo], ['Livello', p.livello], ['Cliente dal', data(p.data_inizio)], ['Note', p.note]
  ].filter(([, x]) => x);
  const prossimi = d.appuntamenti.filter((a) => new Date(a.inizio) > new Date()).reverse();
  const storico = d.appuntamenti.filter((a) => new Date(a.inizio) <= new Date());
  const rigaApp = (a) => {
    const stato = a.stato === 'programmato' && new Date(a.inizio) <= new Date() ? 'svolto' : a.stato;
    const [l, c] = STATI_APP[stato] || [stato, 'b-grey'];
    return `<div class="row"><div class="grow">${dataOra(a.inizio)}<div class="muted small">${esc(a.titolo || '')}</div></div><div class="right"><span class="badge ${c}">${l}</span></div></div>`;
  };

  content.innerHTML = `<a class="back" id="back">← Anagrafica</a>
    <h2>${esc(p.nome)} ${esc(p.cognome)}</h2>
    <div class="toolbar">${badgeRate(s)}${s.numRinnovi ? ' <span class="badge b-purple">↻ rinnovato</span>' : ''}</div>
    <div class="grid-2">
      <div class="panel"><h3>Dati</h3><dl class="kv">${info.map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}</dl></div>
      ${cliente.sezioni.includes('appuntamenti') ? `<div class="panel"><h3>Frequenza</h3><div class="stats">
        <div class="stat"><span>Svolti</span><strong>${st.svolti}</strong></div>
        <div class="stat"><span>Viene in media</span><strong>${st.mediaGiorni === null ? '—' : `ogni ${String(st.mediaGiorni).replace('.', ',')} gg`}</strong></div>
        <div class="stat"><span>Ultime 4 sett.</span><strong>${String(st.perSettimana).replace('.', ',')} / sett.</strong></div>
        <div class="stat"><span>Ultimo</span><strong>${st.giorniDallUltimo === null ? '—' : `${st.giorniDallUltimo} gg fa`}</strong></div>
        <div class="stat"><span>Prossimo</span><strong>${st.prossimo ? dataOra(st.prossimo) : '—'}</strong></div>
        <div class="stat"><span>Assenze</span><strong>${st.assenze}</strong></div></div></div>` : ''}
    </div>
    <div class="panel"><h3>Percorsi e rate</h3>${
      s.percorsi.length
        ? s.percorsi
            .map((pc) => `<div class="percorso ${pc.rate.some((r) => r.stato === 'in_ritardo') ? 'late' : ''}">
              <strong>${esc(TIPI[pc.tipo] || pc.tipo)}</strong>
              ${{ in_corso: '<span class="badge b-blue">In corso</span>', futuro: '<span class="badge b-grey">Da iniziare</span>', concluso: '<span class="badge b-grey">Concluso</span>' }[pc.stato]}
              ${pc.rinnovo_di ? '<span class="badge b-purple">↻ Rinnovo</span>' : ''}
              <div class="muted small">${pc.durata_mesi} ${pc.durata_mesi === 1 ? 'mese' : 'mesi'} · dal ${data(pc.data_inizio)} al ${data(pc.fine)} ·
                ${pc.importo_totale !== null ? eur(pc.importo_totale) : '—'} ${pc.modalita === 'rate' ? `in ${pc.numero_rate} rate` : 'in unica soluzione'} · pagato ${eur(pc.pagato)}</div>
              ${righeRate(pc.rate)}</div>`)
            .join('')
        : '<div class="muted">Nessun percorso.</div>'
    }${s.legacy.rate.length ? `<h3>Altri pagamenti</h3>${righeRate(s.legacy.rate)}` : ''}</div>
    ${cliente.sezioni.includes('appuntamenti') ? `<div class="panel"><h3>Prossimi appuntamenti</h3>${prossimi.length ? `<div class="list">${prossimi.map(rigaApp).join('')}</div>` : '<div class="muted">Nessuno.</div>'}
      <h3 class="mt">Storico</h3>${storico.length ? `<div class="list">${storico.map(rigaApp).join('')}</div>` : '<div class="muted">Nessuno.</div>'}</div>` : ''}`;
  $('#back').onclick = () => vai({ tab: 'anagrafica' });
}

// ---------- Appuntamenti -----------------------------------------------------
let vistaApp = 'prossimi';
VISTE.appuntamenti = async () => {
  const tutti = await api('appuntamenti');
  const disegna = () => {
    const ora = new Date();
    let l = tutti;
    if (vistaApp === 'prossimi') l = tutti.filter((a) => new Date(a.inizio) > ora).reverse();
    if (vistaApp === 'storico') l = tutti.filter((a) => new Date(a.inizio) <= ora);
    content.innerHTML = `<h2>Appuntamenti</h2>
      <div class="chips">${[['prossimi', 'Prossimi'], ['storico', 'Storico'], ['tutti', 'Tutti']]
        .map(([k, t]) => `<button class="chip ${vistaApp === k ? 'active' : ''}" data-v="${k}">${t}</button>`).join('')}</div>
      <div class="panel"><div class="list">${
        l.length
          ? l.slice(0, 300).map((a) => {
              const stato = a.stato === 'programmato' && new Date(a.inizio) <= ora ? 'svolto' : a.stato;
              const [t, c] = STATI_APP[stato] || [stato, 'b-grey'];
              return `<div class="row ${a.persona_id ? 'click' : ''}" ${a.persona_id ? `data-persona="${a.persona_id}"` : ''}>
                <div class="grow"><strong>${esc(a.persona_nome || a.titolo || 'Appuntamento')}</strong><div class="muted small">${dataOra(a.inizio)}${a.persona_nome && a.titolo ? ' · ' + esc(a.titolo) : ''}</div></div>
                <div class="right"><span class="badge ${c}">${t}</span></div></div>`;
            }).join('')
          : '<div class="muted">Nessun appuntamento.</div>'
      }</div></div>`;
    content.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { vistaApp = b.dataset.v; disegna(); }));
  };
  disegna();
};

// ---------- Pagamenti e rate -------------------------------------------------
let filtroR = 'aperte';
VISTE.pagamenti = async () => {
  const { oggi, rate } = await api('rate');
  const mm = oggi.slice(0, 7);
  const somma = (l) => l.reduce((t, r) => t + (Number(r.importo) || 0), 0);
  const ritardo = rate.filter((r) => r.stato === 'in_ritardo');
  const scad = rate.filter((r) => r.stato === 'da_pagare' && r.scadenza?.slice(0, 7) === mm);
  const inc = rate.filter((r) => r.stato === 'pagata' && r.pagamento?.pagato_il?.slice(0, 7) === mm);
  const F = {
    aperte: ['Da incassare', (r) => r.stato === 'in_ritardo' || r.stato === 'da_pagare'],
    ritardo: ['In ritardo', (r) => r.stato === 'in_ritardo'],
    pagate: ['Pagate', (r) => r.stato === 'pagata' || r.stato === 'esente'],
    tutte: ['Tutte', () => true]
  };
  const disegna = () => {
    const ord = { in_ritardo: 0, da_pagare: 1, pagata: 2, esente: 3 };
    const l = rate.filter(F[filtroR][1]).sort((a, b) => ord[a.stato] - ord[b.stato] || String(a.scadenza).localeCompare(String(b.scadenza)));
    content.innerHTML = `<h2>Pagamenti e rate</h2>
      <div class="cards">
        <div class="card ${ritardo.length ? 'alert' : ''}"><div class="label">In ritardo</div><div class="value">${eur(somma(ritardo))}</div><div class="sub">${ritardo.length} rate</div></div>
        <div class="card"><div class="label">Scadono questo mese</div><div class="value">${eur(somma(scad))}</div><div class="sub">${scad.length} rate</div></div>
        <div class="card"><div class="label">Incassato questo mese</div><div class="value">${eur(somma(inc))}</div><div class="sub">${inc.length} rate</div></div>
      </div>
      <div class="chips">${Object.entries(F).map(([k, [t, fn]]) => {
        const n = rate.filter(fn).length;
        return `<button class="chip ${filtroR === k ? 'active' : ''} ${k === 'ritardo' && n ? 'alert' : ''}" data-r="${k}">${t} (${n})</button>`;
      }).join('')}</div>
      <div class="panel"><div class="list">${
        l.length
          ? l.map((r) => `<div class="row ${r.stato === 'in_ritardo' ? 'late' : ''}">
              <div class="grow"><strong class="click" data-persona="${r.persona.id}">${esc(r.persona.cognome)} ${esc(r.persona.nome)}</strong>
                <div class="muted small">${esc(etichettaRata(r))}${r.tipo_percorso ? ' · ' + esc(TIPI[r.tipo_percorso] || '') : ''}${r.scadenza ? ' · scad. ' + data(r.scadenza) : ''}
                  ${r.pagamento && !r.pagamento.esente ? ' · pagata il ' + data(r.pagamento.pagato_il) : ''}</div>
                ${r.pagamento?.documento_id ? `<a class="small" href="/api/documento?id=${r.pagamento.documento_id}" target="_blank" rel="noopener">📄 Contabile</a>` : ''}</div>
              <div class="right">${r.importo !== null && r.importo !== undefined ? `<div>${eur(r.importo)}</div>` : ''}${STATO_RATA[r.stato] || ''}</div></div>`).join('')
          : '<div class="muted">Nessuna rata.</div>'
      }</div>${l.length ? `<div class="totale">Totale ${eur(somma(l))}</div>` : ''}</div>`;
    content.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { filtroR = b.dataset.r; disegna(); }));
  };
  disegna();
};

// ---------- Fatturazione e acquisti -------------------------------------------
VISTE.fatture = async () => {
  const f = await api('fatture');
  const tot = (x) => Number(x.imponibile) * (1 + Number(x.iva_perc) / 100);
  const STATO = { da_pagare: ['Da pagare', 'b-warn'], pagata: ['Pagata', 'b-ok'], annullata: ['Annullata', 'b-grey'] };
  content.innerHTML = `<h2>Fatturazione</h2><div class="panel"><div class="list">${
    f.length
      ? f.map((x) => `<div class="row"><div class="grow"><strong>${esc(x.numero)}</strong> · ${data(x.data)}<div class="muted small">${esc(x.descrizione || '')}</div></div>
          <div class="right"><div>${eur(tot(x))}</div><span class="badge ${STATO[x.stato]?.[1] || 'b-grey'}">${STATO[x.stato]?.[0] || esc(x.stato)}</span></div></div>`).join('')
      : '<div class="muted">Nessuna fattura.</div>'
  }</div>${f.length ? `<div class="totale">Totale ${eur(f.filter((x) => x.stato !== 'annullata').reduce((t, x) => t + tot(x), 0))}</div>` : ''}</div>`;
};

// ordini ai fornitori: giallo se mancano 5 giorni o meno alla consegna, rosso se in ritardo
function statoOrdine(o) {
  if (o.consegnato) return ['b-ok', o.data_consegna ? `Consegnato il ${data(o.data_consegna)}` : 'Consegnato', ''];
  if (!o.consegna_prevista) return ['b-blue', 'In attesa', ''];
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const g = Math.round((new Date(o.consegna_prevista + 'T00:00:00') - oggi) / 86400000);
  if (g < 0) return ['b-late', `In ritardo di ${-g} ${g === -1 ? 'giorno' : 'giorni'}`, 'late'];
  if (g <= 5) return ['b-yellow', g === 0 ? 'Arriva oggi' : g === 1 ? 'Arriva domani' : `Arriva tra ${g} giorni`, 'arrivo'];
  return ['b-blue', `Tra ${g} giorni`, ''];
}

let filtroA = 'da_ricevere';
VISTE.acquisti = async () => {
  const a = await api('acquisti');
  const F = { da_ricevere: ['Da ricevere', (x) => !x.consegnato], consegnati: ['Consegnati', (x) => x.consegnato], tutti: ['Tutti', () => true] };
  const disegna = () => {
    const l = a.filter(F[filtroA][1]);
    content.innerHTML = `<h2>Acquisti</h2>
      <div class="chips">${Object.entries(F).map(([k, [t, fn]]) => `<button class="chip ${filtroA === k ? 'active' : ''}" data-a="${k}">${t} (${a.filter(fn).length})</button>`).join('')}</div>
      <div class="panel"><div class="list">${
        l.length
          ? l.map((x) => {
              const [cls, testo, riga] = statoOrdine(x);
              return `<div class="row ${riga}"><div class="grow"><strong>${esc(x.descrizione)}</strong>
                <div class="muted small">${x.fornitore ? esc(x.fornitore) + ' · ' : ''}ordinato il ${data(x.data)}${x.consegna_prevista ? ' · consegna prevista ' + data(x.consegna_prevista) : ''}</div></div>
                <div class="right"><div>${eur(x.importo)}</div><span class="badge ${cls}">${testo}</span></div></div>`;
            }).join('')
          : '<div class="muted">Nessun ordine.</div>'
      }</div>${l.length ? `<div class="totale">Totale ${eur(l.reduce((t, x) => t + Number(x.importo), 0))}</div>` : ''}</div>`;
    content.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { filtroA = b.dataset.a; disegna(); }));
  };
  disegna();
};

// ---------- Avvio --------------------------------------------------------------
avvia(true);
