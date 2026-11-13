/* global api */
'use strict';

// ---------- Utilità ----------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const content = $('#content');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('it-IT') : '');
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};
const today = () => new Date().toISOString().slice(0, 10);
const totaleFattura = (f) => Number(f.imponibile) * (1 + Number(f.iva_perc) / 100);

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isError ? 6000 : 2500);
}

async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

// ---------- Modale form generica -------------------------------------------
// fields: [{ name, label, type, options, required, full, value }]
function openForm({ title, fields, values = {}, onSubmit }) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = fields
    .map((f) => {
      const v = values[f.name] ?? f.value ?? '';
      const req = f.required ? 'required' : '';
      const cls = f.full || f.type === 'textarea' ? 'full' : '';
      let input;
      if (f.type === 'textarea') input = `<textarea name="${f.name}" ${req}>${esc(v)}</textarea>`;
      else if (f.type === 'select')
        input = `<select name="${f.name}" ${req}>${f.options
          .map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`)
          .join('')}</select>`;
      else if (f.type === 'checkbox')
        return `<label class="check ${cls}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
      else input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${req}>`;
      return `<label class="${cls}">${esc(f.label)}${input}</label>`;
    })
    .join('');

  const form = $('#modal-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      data[f.name] = f.type === 'checkbox' ? el.checked : el.value;
    }
    try {
      await onSubmit(data);
      dlg.close();
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('#modal-cancel').onclick = () => dlg.close();
  dlg.showModal();
}

// ---------- Sidebar ---------------------------------------------------------
let clienti = [];
let route = { name: 'home' };

async function loadClienti() {
  try {
    clienti = await api.clienti.list();
  } catch {
    clienti = [];
  }
  renderMenu();
}

function renderMenu() {
  const q = $('#search-clienti').value.trim().toLowerCase();
  const list = clienti.filter((c) => c.nome.toLowerCase().includes(q));
  $('#clienti-menu').innerHTML = list.length
    ? list
        .map(
          (c) =>
            `<a href="#" class="nav-item ${route.name === 'cliente' && route.id === c.id ? 'active' : ''}" data-cliente="${c.id}">${esc(c.nome)}</a>`
        )
        .join('')
    : `<div class="empty">${clienti.length ? 'Nessun risultato' : 'Nessun cliente'}</div>`;
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route.name));
}

document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-route]');
  if (r) { e.preventDefault(); go({ name: r.dataset.route }); return; }
  const c = e.target.closest('[data-cliente]');
  if (c) { e.preventDefault(); go({ name: 'cliente', id: Number(c.dataset.cliente), tab: c.dataset.tab }); }
});
$('#search-clienti').addEventListener('input', renderMenu);
$('#btn-new-cliente').addEventListener('click', () => editCliente());

function go(r) {
  route = r;
  renderMenu();
  const views = { home: renderHome, cliente: renderCliente, settings: renderSettings };
  (views[r.name] || renderHome)();
}

// ---------- Home ------------------------------------------------------------
async function renderHome() {
  const info = await api.appInfo();
  if (!info.dbReady) {
    content.innerHTML = `
      <h1>Benvenuto</h1>
      <div class="subtitle">Zuk Gestionale</div>
      <div class="notice">Il database non è connesso. Vai su <a class="link" data-route="settings">Impostazioni</a> e configura la connessione a PostgreSQL.</div>`;
    return;
  }
  content.innerHTML = '<h1>Home</h1><div class="subtitle">Caricamento…</div>';
  const d = await safe(() => api.dashboard());
  content.innerHTML = `
    <h1>Home</h1>
    <div class="subtitle">${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <div class="cards">
      <div class="card"><div class="label">Clienti</div><div class="value">${d.numClienti}</div></div>
      <div class="card"><div class="label">Prossimi appuntamenti</div><div class="value">${d.prossimi.length}</div></div>
      <div class="card"><div class="label">Fatture da incassare</div><div class="value">${d.fattureAperte}</div></div>
      <div class="card"><div class="label">Totale da incassare</div><div class="value">${eur(d.daIncassare)}</div></div>
    </div>
    <div class="panel">
      <h3>Prossimi appuntamenti</h3>
      <div class="list-appuntamenti">
        ${
          d.prossimi.length
            ? d.prossimi
                .map(
                  (a) => `<div class="item">
                    <div><strong>${esc(a.titolo)}</strong> · <a class="link" data-cliente="${a.cliente_id}" data-tab="appuntamenti">${esc(a.cliente_nome)}</a>
                    ${a.luogo ? `<div class="muted">${esc(a.luogo)}</div>` : ''}</div>
                    <div class="muted">${fmtDateTime(a.inizio)}</div>
                  </div>`
                )
                .join('')
            : '<div class="muted">Nessun appuntamento in programma.</div>'
        }
      </div>
    </div>`;
}

// ---------- Cliente ---------------------------------------------------------
const CLIENTE_FIELDS = [
  { name: 'nome', label: 'Nome / Ragione sociale', required: true, full: true },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'telefono', label: 'Telefono' },
  { name: 'partita_iva', label: 'P.IVA / Codice fiscale' },
  { name: 'indirizzo', label: 'Indirizzo' },
  { name: 'note', label: 'Note', type: 'textarea' }
];

function editCliente(cliente) {
  openForm({
    title: cliente ? 'Modifica cliente' : 'Nuovo cliente',
    fields: CLIENTE_FIELDS,
    values: cliente || {},
    onSubmit: async (data) => {
      const saved = cliente ? await api.clienti.update(cliente.id, data) : await api.clienti.create(data);
      toast(cliente ? 'Cliente aggiornato' : 'Cliente creato (database dedicato pronto)');
      await loadClienti();
      go({ name: 'cliente', id: saved.id, tab: route.tab });
    }
  });
}

const SECTIONS = {
  appuntamenti: {
    label: 'Appuntamenti',
    singolare: 'appuntamento',
    nuovo: 'Nuovo appuntamento',
    vuoto: 'Nessun appuntamento registrato.',
    fields: [
      { name: 'titolo', label: 'Titolo', required: true, full: true },
      { name: 'inizio', label: 'Inizio', type: 'datetime-local', required: true },
      { name: 'fine', label: 'Fine', type: 'datetime-local' },
      { name: 'luogo', label: 'Luogo', full: true },
      { name: 'note', label: 'Note', type: 'textarea' }
    ],
    toForm: (r) => ({ ...r, inizio: toLocalInput(r.inizio), fine: toLocalInput(r.fine) }),
    fromForm: (d) => ({ ...d, inizio: d.inizio ? new Date(d.inizio).toISOString() : '', fine: d.fine ? new Date(d.fine).toISOString() : '' }),
    columns: [
      ['Quando', (r) => fmtDateTime(r.inizio)],
      ['Titolo', (r) => esc(r.titolo)],
      ['Luogo', (r) => esc(r.luogo)],
      ['Note', (r) => esc(r.note)]
    ]
  },
  fatture: {
    label: 'Fatturazione',
    singolare: 'fattura',
    nuovo: 'Nuova fattura',
    vuoto: 'Nessuna fattura registrata.',
    fields: [
      { name: 'numero', label: 'Numero', required: true },
      { name: 'data', label: 'Data', type: 'date', required: true, value: today() },
      { name: 'descrizione', label: 'Descrizione', full: true },
      { name: 'imponibile', label: 'Imponibile (€)', type: 'number', step: '0.01', required: true },
      { name: 'iva_perc', label: 'IVA %', type: 'number', step: '0.01', value: 22 },
      {
        name: 'stato', label: 'Stato', type: 'select', value: 'da_pagare',
        options: [['da_pagare', 'Da pagare'], ['pagata', 'Pagata'], ['annullata', 'Annullata']]
      },
      { name: 'note', label: 'Note', type: 'textarea' }
    ],
    columns: [
      ['Numero', (r) => esc(r.numero)],
      ['Data', (r) => fmtDate(r.data)],
      ['Descrizione', (r) => esc(r.descrizione)],
      ['Imponibile', (r) => eur(r.imponibile), 'num'],
      ['IVA', (r) => `${Number(r.iva_perc)}%`, 'num'],
      ['Totale', (r) => eur(totaleFattura(r)), 'num'],
      ['Stato', (r) => `<span class="badge ${esc(r.stato)}">${esc(r.stato.replace('_', ' '))}</span>`]
    ],
    footer: (rows) => {
      const valide = rows.filter((r) => r.stato !== 'annullata');
      const tot = valide.reduce((s, r) => s + totaleFattura(r), 0);
      const aperto = valide.filter((r) => r.stato === 'da_pagare').reduce((s, r) => s + totaleFattura(r), 0);
      return `Totale fatturato: ${eur(tot)} · Da incassare: ${eur(aperto)}`;
    }
  },
  acquisti: {
    label: 'Acquisti',
    singolare: 'acquisto',
    nuovo: 'Nuovo acquisto',
    vuoto: 'Nessun acquisto registrato.',
    fields: [
      { name: 'data', label: 'Data', type: 'date', required: true, value: today() },
      { name: 'fornitore', label: 'Fornitore' },
      { name: 'descrizione', label: 'Descrizione', required: true, full: true },
      { name: 'importo', label: 'Importo (€)', type: 'number', step: '0.01', required: true },
      { name: 'note', label: 'Note', type: 'textarea' }
    ],
    columns: [
      ['Data', (r) => fmtDate(r.data)],
      ['Fornitore', (r) => esc(r.fornitore)],
      ['Descrizione', (r) => esc(r.descrizione)],
      ['Importo', (r) => eur(r.importo), 'num']
    ],
    footer: (rows) => `Totale acquisti: ${eur(rows.reduce((s, r) => s + Number(r.importo), 0))}`
  }
};

async function renderCliente() {
  const tab = route.tab && SECTIONS[route.tab] ? route.tab : 'appuntamenti';
  route.tab = tab;
  const cliente = await safe(() => api.clienti.get(route.id));
  if (!cliente) return go({ name: 'home' });

  content.innerHTML = `
    <div class="header-row">
      <div>
        <h1>${esc(cliente.nome)}</h1>
        <div class="subtitle">${[cliente.email, cliente.telefono, cliente.partita_iva].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
      </div>
      <div class="btn-row">
        <button class="btn" id="btn-edit-cliente">Modifica</button>
        <button class="btn danger" id="btn-archive-cliente">Archivia</button>
      </div>
    </div>
    <div class="tabs">
      ${Object.entries(SECTIONS)
        .map(([k, s]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${s.label}</button>`)
        .join('')}
    </div>
    <div id="section"></div>`;

  $('#btn-edit-cliente').onclick = () => editCliente(cliente);
  $('#btn-archive-cliente').onclick = async () => {
    if (!confirm(`Archiviare "${cliente.nome}"? I dati restano nel suo database.`)) return;
    await safe(() => api.clienti.archive(cliente.id, true));
    toast('Cliente archiviato');
    await loadClienti();
    go({ name: 'home' });
  };
  content.querySelectorAll('.tab').forEach((b) => (b.onclick = () => go({ ...route, tab: b.dataset.tab })));

  await renderSection(cliente, tab);
}

async function renderSection(cliente, table) {
  const s = SECTIONS[table];
  const el = $('#section');
  const rows = await safe(() => api.records.list(cliente.id, table));

  el.innerHTML = `
    <div class="header-row" style="margin-bottom:12px">
      <div class="muted">${s.footer ? s.footer(rows) : `${rows.length} ${s.label.toLowerCase()}`}</div>
      <button class="btn primary" id="btn-add">＋ ${s.nuovo}</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${s.columns.map(([h, , cls]) => `<th class="${cls || ''}">${h}</th>`).join('')}<th></th></tr></thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (r) => `<tr>${s.columns.map(([, fn, cls]) => `<td class="${cls || ''}">${fn(r)}</td>`).join('')}
                    <td class="row-actions">
                      <button class="btn small" data-edit="${r.id}">Modifica</button>
                      <button class="btn small danger" data-del="${r.id}">Elimina</button>
                    </td></tr>`
                )
                .join('')
            : `<tr><td class="empty-row" colspan="${s.columns.length + 1}">${s.vuoto}</td></tr>`
        }
      </tbody>
    </table></div>`;

  const refresh = () => renderSection(cliente, table);
  const openEditor = (row) =>
    openForm({
      title: row ? `Modifica ${s.singolare}` : s.nuovo,
      fields: s.fields,
      values: row ? (s.toForm ? s.toForm(row) : row) : {},
      onSubmit: async (data) => {
        const payload = s.fromForm ? s.fromForm(data) : data;
        if (row) await api.records.update(cliente.id, table, row.id, payload);
        else await api.records.create(cliente.id, table, payload);
        toast('Salvato');
        refresh();
      }
    });

  $('#btn-add').onclick = () => openEditor();
  el.querySelectorAll('[data-edit]').forEach(
    (b) => (b.onclick = () => openEditor(rows.find((r) => r.id === Number(b.dataset.edit))))
  );
  el.querySelectorAll('[data-del]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm(`Eliminare questo elemento (${s.singolare})?`)) return;
        await safe(() => api.records.remove(cliente.id, table, Number(b.dataset.del)));
        toast('Eliminato');
        refresh();
      })
  );
}

// ---------- Impostazioni ----------------------------------------------------
async function renderSettings() {
  const cfg = await api.settings.get();
  const info = await api.appInfo();
  const db = cfg.db;
  content.innerHTML = `
    <h1>Impostazioni</h1>
    <div class="subtitle">Versione ${esc(info.version)} · Database ${info.dbReady ? '🟢 connesso' : '🔴 non connesso'}</div>
    <div class="panel">
      <h3>Connessione PostgreSQL</h3>
      <p class="muted">Ogni cliente ha un database dedicato (<code>${esc(db.clientDbPrefix)}&lt;id&gt;</code>). L'elenco clienti è nel database <code>${esc(db.masterDb)}</code>. I database vengono creati automaticamente: l'utente deve avere il permesso <code>CREATEDB</code>.</p>
      <form id="db-form" class="form-grid">
        <label class="full">Incolla la stringa di connessione (es. da Neon) per compilare i campi
          <input id="conn-string" placeholder="postgresql://utente:password@host/neondb?sslmode=require">
        </label>
        <label>Host<input name="host" value="${esc(db.host)}" required></label>
        <label>Porta<input name="port" type="number" value="${esc(db.port)}" required></label>
        <label>Utente<input name="user" value="${esc(db.user)}" required></label>
        <label>Password<input name="password" type="password" value="${esc(db.password)}"></label>
        <label>Database anagrafica<input name="masterDb" value="${esc(db.masterDb)}" pattern="[a-z_][a-z0-9_]*" required></label>
        <label>Prefisso DB clienti<input name="clientDbPrefix" value="${esc(db.clientDbPrefix)}" pattern="[a-z_][a-z0-9_]*" required></label>
        <label class="check full"><input type="checkbox" name="ssl" ${db.ssl ? 'checked' : ''}> Usa SSL</label>
        <div class="btn-row full">
          <button type="button" class="btn" id="btn-test">Prova connessione</button>
          <button type="submit" class="btn primary">Salva e connetti</button>
        </div>
      </form>
    </div>
    <div class="panel">
      <h3>Aggiornamenti</h3>
      <p class="muted">L'app controlla automaticamente la presenza di nuove versioni all'avvio e ogni 30 minuti.</p>
      <button class="btn" id="btn-check-update">Controlla ora</button>
    </div>`;

  const form = $('#db-form');
  const read = () => ({
    host: form.host.value.trim(),
    port: Number(form.port.value),
    user: form.user.value.trim(),
    password: form.password.value,
    masterDb: form.masterDb.value.trim(),
    clientDbPrefix: form.clientDbPrefix.value.trim(),
    ssl: form.ssl.checked
  });
  $('#conn-string').addEventListener('input', (e) => {
    const raw = e.target.value.trim().replace(/^psql\s+/, '').replace(/^['"]|['"]$/g, '');
    if (!/^postgres(ql)?:\/\//.test(raw)) return;
    try {
      const u = new URL(raw.replace(/^postgres(ql)?:/, 'http:'));
      // Meglio la connessione diretta: il pooler di Neon non serve a un'app desktop
      form.host.value = u.hostname.replace('-pooler.', '.');
      form.port.value = u.port || 5432;
      form.user.value = decodeURIComponent(u.username);
      form.password.value = decodeURIComponent(u.password);
      form.ssl.checked = u.searchParams.get('sslmode') !== 'disable' && u.hostname !== 'localhost';
      e.target.value = '';
      toast('Campi compilati: ora premi "Prova connessione"');
    } catch {
      toast('Stringa di connessione non valida', true);
    }
  });
  $('#btn-test').onclick = async () => {
    const v = await safe(() => api.settings.test(read()));
    toast('Connessione OK: ' + v.split(',')[0]);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    await safe(() => api.settings.save(read()));
    toast('Connesso al database');
    await loadClienti();
    renderSettings();
  };
  $('#btn-check-update').onclick = () => api.updater.check();
}

// ---------- Aggiornamenti ---------------------------------------------------
const banner = $('#update-banner');
function showBanner(html) {
  banner.innerHTML = html + '<button class="close" title="Chiudi">✕</button>';
  banner.classList.remove('hidden');
  banner.querySelector('.close').onclick = () => banner.classList.add('hidden');
}

api.updater.onEvent((ev) => {
  switch (ev.type) {
    case 'available':
      showBanner(`<div>🎉 Nuova versione <strong>${esc(ev.version)}</strong> disponibile</div><button class="btn small" id="upd-download">Aggiorna</button>`);
      $('#upd-download').onclick = () => {
        showBanner('<div>Download in corso…</div><div class="progress"><div style="width:0%"></div></div>');
        api.updater.download();
      };
      break;
    case 'progress': {
      const bar = banner.querySelector('.progress > div');
      if (bar) bar.style.width = ev.percent + '%';
      break;
    }
    case 'downloaded':
      showBanner(`<div>Versione <strong>${esc(ev.version)}</strong> pronta</div><button class="btn small" id="upd-install">Riavvia e installa</button>`);
      $('#upd-install').onclick = () => api.updater.install();
      break;
    case 'not-available':
      if (route.name === 'settings') toast('Stai usando l\'ultima versione');
      break;
    case 'dev':
      if (route.name === 'settings') toast(ev.message);
      break;
    case 'error':
      if (route.name === 'settings') toast('Errore aggiornamento: ' + ev.message, true);
      break;
  }
});

// ---------- Avvio -----------------------------------------------------------
(async () => {
  const info = await api.appInfo();
  $('#app-version').textContent = info.version;
  await loadClienti();
  go({ name: info.dbReady ? 'home' : 'settings' });
})();
