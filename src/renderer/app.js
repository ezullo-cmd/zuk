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
// Colori proposti per i clienti
const PALETTE = ['#2f6fed', '#0f9d8a', '#1f9d55', '#c98a12', '#e8590c', '#d64545', '#d6336c', '#7048e8', '#495057'];
// Testo bianco o scuro a seconda della luminosità del colore di sfondo
const textOn = (hex) => {
  const n = parseInt(String(hex || '#2f6fed').slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#1d2330' : '#ffffff';
};
const meseLabel = (periodo) =>
  periodo ? new Date(periodo + 'T00:00:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : '';
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
function openForm({ title, fields, values = {}, onSubmit, onInput }) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = fields
    .map((f) => {
      const v = values[f.name] ?? f.value ?? '';
      const req = f.required ? 'required' : '';
      const cls = f.full || f.type === 'textarea' ? 'full' : '';
      let input;
      if (f.type === 'heading') return `<div class="form-heading">${esc(f.label)}</div>`;
      if (f.type === 'html') return `<div class="full form-html" id="${f.name}"></div>`;
      if (f.type === 'image')
        return `<div class="field full"><span class="field-label">${esc(f.label)}</span>
          <div class="image-field">
            <div class="image-preview ${v ? '' : 'empty'}">${v ? `<img src="${esc(v)}" alt="">` : 'Nessuna immagine'}</div>
            <div class="image-actions">
              <label class="btn small">Scegli immagine…<input type="file" accept="image/*" data-image-for="${f.name}" hidden></label>
              <button type="button" class="btn small ghost" data-image-clear="${f.name}" ${v ? '' : 'hidden'}>Rimuovi</button>
              <div class="muted small">PNG, JPG o SVG. Viene ridimensionata automaticamente.</div>
            </div>
            <input type="hidden" name="${f.name}" value="${esc(v)}">
          </div></div>`;
      if (f.type === 'file')
        return `<label class="${cls || 'full'}">${esc(f.label)}<input name="${f.name}" type="file" accept="${f.accept || ''}" ${req}></label>`;
      if (f.type === 'textarea') input = `<textarea name="${f.name}" ${req}>${esc(v)}</textarea>`;
      else if (f.type === 'select')
        input = `<select name="${f.name}" ${req}>${f.options
          .map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`)
          .join('')}</select>`;
      else if (f.type === 'checkbox')
        return `<label class="check ${cls}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
      else if (f.type === 'color')
        return `<div class="field full"><span class="field-label">${esc(f.label)}</span>
          <div class="color-picker">
            ${PALETTE.map((c) => `<button type="button" class="swatch ${c === v ? 'selected' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
            <label class="swatch custom" title="Altro colore"><input type="color" name="${f.name}" value="${esc(v || PALETTE[0])}"></label>
          </div></div>`;
      else if (f.type === 'multi')
        return `<div class="field full"><span class="field-label">${esc(f.label)}</span>
          <div class="multi-grid" data-multi="${f.name}">
            ${f.options
              .map(
                ([val, lab, desc]) => `<label class="multi-option">
                  <input type="checkbox" value="${esc(val)}" ${(v || []).includes(val) ? 'checked' : ''}>
                  <span><strong>${esc(lab)}</strong>${desc ? `<small>${esc(desc)}</small>` : ''}</span>
                </label>`
              )
              .join('')}
          </div></div>`;
      else input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${req}>`;
      return `<label class="${cls}">${esc(f.label)}${input}</label>`;
    })
    .join('');

  const form = $('#modal-form');
  form.querySelectorAll('.color-picker').forEach((picker) => {
    const input = picker.querySelector('input[type=color]');
    const mark = () =>
      picker.querySelectorAll('.swatch[data-color]').forEach((s) => s.classList.toggle('selected', s.dataset.color === input.value));
    picker.querySelectorAll('.swatch[data-color]').forEach((s) => (s.onclick = () => { input.value = s.dataset.color; mark(); }));
    input.addEventListener('input', mark);
  });
  form.querySelectorAll('[data-image-for]').forEach((input) => {
    const name = input.dataset.imageFor;
    const wrap = input.closest('.image-field');
    const set = (url) => {
      form.elements[name].value = url;
      const prev = wrap.querySelector('.image-preview');
      prev.classList.toggle('empty', !url);
      prev.innerHTML = url ? `<img src="${url}" alt="">` : 'Nessuna immagine';
      wrap.querySelector('[data-image-clear]').hidden = !url;
    };
    input.onchange = async () => {
      if (!input.files[0]) return;
      try {
        set(await ridimensionaImmagine(input.files[0], 256));
      } catch {
        toast('Impossibile leggere questa immagine', true);
      }
      input.value = '';
    };
    wrap.querySelector('[data-image-clear]').onclick = () => set('');
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      if (f.type === 'heading' || f.type === 'html') continue;
      if (f.type === 'file') {
        data[f.name] = form.elements[f.name].files[0] || null;
        continue;
      }
      if (f.type === 'multi') {
        data[f.name] = [...form.querySelectorAll(`[data-multi="${f.name}"] input:checked`)].map((i) => i.value);
        if (f.required && !data[f.name].length) return toast(`${f.label}: seleziona almeno una voce`, true);
        continue;
      }
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
  // campi visibili solo se un altro campo ha un certo valore (es. numero rate solo "a rate")
  const leggi = () => Object.fromEntries(fields.filter((f) => f.name && form.elements[f.name]).map((f) => [f.name, form.elements[f.name].value]));
  const aggiorna = () => {
    const v = leggi();
    for (const f of fields.filter((x) => x.showIf)) {
      const el = form.elements[f.name];
      const ok = [].concat(f.showIf.value).includes(v[f.showIf.field]);
      el.disabled = !ok;
      el.closest('label, .field').classList.toggle('hidden', !ok);
    }
    if (onInput) onInput(v, form);
  };
  form.oninput = aggiorna;
  form.onchange = aggiorna;
  aggiorna();
  dlg.showModal();
}

// Ridimensiona un'immagine (lato massimo `max` px) e la restituisce come data URL PNG
function ridimensionaImmagine(file, max) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || max;
      const h = img.naturalHeight || max;
      const k = Math.min(1, max / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('immagine non valida')); };
    img.src = url;
  });
}

// Logo del cliente, oppure le iniziali su sfondo colorato
const logoCliente = (c, cls = '') =>
  c.logo
    ? `<span class="logo ${cls}"><img src="${esc(c.logo)}" alt=""></span>`
    : `<span class="logo logo-iniziali ${cls}" style="background:${esc(c.colore)};color:${textOn(c.colore)}">${esc(
        c.nome.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
      )}</span>`;

// ---------- Sidebar ---------------------------------------------------------
let clienti = [];
let route = { name: 'home' };

// numero di persone con rate in ritardo per ogni cliente (pallino rosso nel menù)
let ritardiPerCliente = {};

async function loadClienti() {
  try {
    clienti = await api.clienti.list();
  } catch {
    clienti = [];
  }
  renderMenu();
  aggiornaRitardi();
}

// pallino rosso sulle schede Anagrafica e Pagamenti del cliente aperto
function badgeSchede() {
  if (route.name !== 'cliente') return;
  const n = ritardiPerCliente[route.id];
  content.querySelectorAll('.tab[data-tab="pagamenti"], .tab[data-tab="anagrafica"]').forEach((b) => {
    b.querySelector('.count-late')?.remove();
    if (n) b.insertAdjacentHTML('beforeend', ` <span class="count-late">${n}</span>`);
  });
}

async function aggiornaRitardi() {
  try {
    const d = await api.dashboard();
    ritardiPerCliente = {};
    for (const r of d.ritardi) ritardiPerCliente[r.cliente_id] = (ritardiPerCliente[r.cliente_id] || 0) + r.rate.length;
    renderMenu();
    badgeSchede();
    return d;
  } catch {
    return null;
  }
}

function renderMenu() {
  const q = $('#search-clienti').value.trim().toLowerCase();
  const list = clienti.filter((c) => c.nome.toLowerCase().includes(q));
  $('#clienti-menu').innerHTML = list.length
    ? list
        .map(
          (c) =>
            `<a href="#" class="nav-item cliente-item ${route.name === 'cliente' && route.id === c.id ? 'active' : ''}" data-cliente="${c.id}" style="--cliente:${esc(c.colore)};--on-cliente:${textOn(c.colore)}">${logoCliente(c, 'logo-sm')}<span class="grow">${esc(c.nome)}</span>${ritardiPerCliente[c.id] ? `<span class="count-late" title="Rate in ritardo">${ritardiPerCliente[c.id]}</span>` : ''}</a>`
        )
        .join('')
    : `<div class="empty">${clienti.length ? 'Nessun risultato' : 'Nessun cliente'}</div>`;
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route.name));
}

document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-route]');
  if (r) { e.preventDefault(); go({ name: r.dataset.route }); return; }
  const c = e.target.closest('[data-cliente]');
  if (c) {
    e.preventDefault();
    go({ name: 'cliente', id: Number(c.dataset.cliente), tab: c.dataset.tab, personaId: c.dataset.persona ? Number(c.dataset.persona) : undefined });
  }
});
$('#search-clienti').addEventListener('input', renderMenu);
$('#btn-new-cliente').addEventListener('click', () => editCliente());

function go(r) {
  route = r;
  content.classList.remove('cliente-page');
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
  const [d, prom] = await Promise.all([safe(() => api.dashboard()), api.promemoria.daInviare().catch(() => [])]);
  content.innerHTML = `
    <h1>Home</h1>
    <div class="subtitle">${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <div class="cards">
      <div class="card"><div class="label">Clienti</div><div class="value">${d.numClienti}</div></div>
      <div class="card"><div class="label">Prossimi appuntamenti</div><div class="value">${d.prossimi.length}</div></div>
      <div class="card ${d.ritardi.length ? 'card-alert' : ''}"><div class="label">Persone con rate in ritardo</div><div class="value">${d.ritardi.length}</div></div>
      <div class="card"><div class="label">Fatture da incassare</div><div class="value">${d.fattureAperte}</div></div>
      <div class="card"><div class="label">Totale da incassare</div><div class="value">${eur(d.daIncassare)}</div></div>
    </div>
    ${
      d.ritardi.length
        ? `<div class="panel panel-alert">
            <h3>⚠️ Rate in ritardo</h3>
            <div class="list-appuntamenti">
              ${d.ritardi
                .map(
                  (r) => `<div class="item">
                    <div><a class="link" data-cliente="${r.cliente_id}" data-tab="anagrafica" data-persona="${r.persona_id}"><strong>${esc(r.persona_nome)}</strong></a>
                      · <span class="muted">${esc(r.cliente_nome)}</span>
                      <div class="muted">${r.rate.map((x) => (x.etichetta ? `${x.etichetta} (scad. ${fmtDate(x.scadenza)})` : meseLabel(x.periodo))).join(', ')}</div></div>
                    <div class="late-amount">${eur(r.rate.reduce((s, x) => s + (Number(x.importo) || 0), 0))}</div>
                  </div>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }
    ${
      prom.length
        ? `<div class="panel promemoria-panel">
            <h3>🔔 Promemoria in attesa <span class="count-late">${prom.length}</span></h3>
            ${prom
              .map(
                (x) => `<div class="prom-row ${x.stato}">
                  <div class="prom-icon">${x.canale === 'email' ? '✉️' : '💬'}</div>
                  <div class="prom-body"><div><strong>${esc(x.cognome)} ${esc(x.nome)}</strong>
                    <span class="muted">· ${esc(x.cliente_nome)} · scadenza ${fmtDate(x.scadenza)}</span></div>
                    ${statoPromemoria(x)}</div>
                  <div class="prom-actions"><button class="btn small" data-cliente="${x.cliente_id}" data-tab="pagamenti">Apri</button></div>
                </div>`
              )
              .join('')}
          </div>`
        : ''
    }
    <div class="panel">
      <h3>Prossimi appuntamenti</h3>
      <div class="list-appuntamenti">
        ${
          d.prossimi.length
            ? d.prossimi
                .map(
                  (a) => `<div class="item">
                    <div><strong>${esc(a.persona_nome || a.titolo || 'Appuntamento')}</strong>${a.persona_nome && a.titolo ? ` <span class="muted">${esc(a.titolo)}</span>` : ''} · <a class="link" data-cliente="${a.cliente_id}" data-tab="appuntamenti">${esc(a.cliente_nome)}</a>
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

// stato leggibile di un promemoria non ancora inviato
function statoPromemoria(x) {
  if (x.stato === 'errore') return `<div class="late-days">Non inviato: ${esc(x.errore)}</div>`;
  if (x.canale === 'whatsapp' && waStato.stato !== 'connesso')
    return '<div class="small warn-text">In attesa: WhatsApp non connesso (pulsante in basso a sinistra)</div>';
  return '<div class="muted small">In coda per l\'invio</div>';
}

// quando il controllo automatico crea nuovi promemoria, aggiorna la pagina se è pertinente
api.promemoria.onAggiornati((esito) => {
  if (!esito || !(esito.email || esito.whatsapp || esito.errori)) return;
  if (route.name === 'home' || (route.name === 'cliente' && route.tab === 'pagamenti')) go(route);
});

// ---------- Cliente ---------------------------------------------------------
const CLIENTE_FIELDS = [
  { name: 'nome', label: 'Nome / Ragione sociale', required: true, full: true },
  { name: 'logo', label: 'Logo', type: 'image' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'telefono', label: 'Telefono' },
  { name: 'partita_iva', label: 'P.IVA / Codice fiscale' },
  { name: 'indirizzo', label: 'Indirizzo' },
  { name: 'note', label: 'Note', type: 'textarea' },
  { name: 'colore', label: 'Colore del cliente', type: 'color' },
  {
    name: 'sezioni', label: 'Sezioni da mostrare nella pagina del cliente', type: 'multi', required: true,
    options: () => SEZIONI_ORDINE.map((k) => [k, SECTIONS[k].label, SECTIONS[k].descrizione])
  },
  { type: 'heading', label: 'Promemoria rate' },
  { name: 'promemoria_attivi', label: 'Invia un promemoria 5 giorni lavorativi prima della scadenza di ogni rata', type: 'checkbox', full: true },
  { name: 'promemoria_testo', label: 'Testo del promemoria', type: 'textarea' },
  { name: 'segnaposto', type: 'html' },
  { name: 'promemoria_oggetto', label: 'Oggetto dell\'email', full: true },
  { name: 'promemoria_mittente', label: 'Nome del mittente nelle email (es. Gianmarco Personal Trainer)', full: true },
  { type: 'heading', label: 'Portale web (sola lettura)' },
  { name: 'portale_attivo', label: 'Il cliente può accedere al portale e consultare i suoi dati', type: 'checkbox', full: true },
  { name: 'portale_utente', label: 'Nome utente', placeholder: 'es. gianmarco' },
  { name: 'portale_password', label: 'Password', type: 'password' },
  { name: 'portale_info', type: 'html' }
];

// password leggibile da comunicare al cliente (niente caratteri ambigui)
function generaPassword() {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const v = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(v, (x) => c[x % c.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}

async function editCliente(cliente) {
  const fields = CLIENTE_FIELDS.map((f) => (typeof f.options === 'function' ? { ...f, options: f.options() } : f));
  const def = await api.promemoria.defaults();
  openForm({
    title: cliente ? 'Modifica cliente' : 'Nuovo cliente',
    fields,
    values: {
      ...(cliente || { colore: PALETTE[clienti.length % PALETTE.length], sezioni: [] }),
      promemoria_testo: cliente?.promemoria_testo || def.testo,
      promemoria_oggetto: cliente?.promemoria_oggetto || def.oggetto,
      promemoria_mittente: cliente?.promemoria_mittente || cliente?.nome || '',
      portale_utente: cliente?.portale_utente || '',
      portale_password: ''
    },
    onInput: (v, form) => {
      const seg = $('#segnaposto');
      if (!seg.innerHTML)
        seg.innerHTML = `<div class="muted small">Puoi usare: <code>&lt;nome&gt;</code> <code>&lt;cognome&gt;</code> <code>&lt;data di scadenza&gt;</code>
          <code>&lt;tipo percorso&gt;</code> <code>&lt;importo&gt;</code> <code>&lt;numero rata&gt;</code>
          · <a class="link" id="testo-default">ripristina testo predefinito</a></div>`;
      $('#testo-default').onclick = () => { form.elements.promemoria_testo.value = def.testo; };
      const info = $('#portale_info');
      if (!info.dataset.pronto) {
        info.dataset.pronto = '1';
        const pw = form.elements.portale_password;
        pw.placeholder = cliente?.portale_ha_password ? '•••••••• (impostata, lascia vuoto per non cambiarla)' : 'almeno 8 caratteri';
        info.innerHTML = `<div class="btn-row"><button type="button" class="btn small" id="btn-genera-pw">Genera password</button>
            <button type="button" class="btn small" id="btn-copia-accesso">Copia dati di accesso</button></div>
          <div class="muted small" id="portale-dettagli"></div>`;
        $('#btn-genera-pw').onclick = () => {
          pw.type = 'text';
          pw.value = generaPassword();
          if (!form.elements.portale_utente.value)
            form.elements.portale_utente.value = (form.elements.nome.value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
          form.elements.portale_attivo.checked = true;
          toast('Password generata: copiala e comunicala al cliente prima di salvare');
        };
        $('#btn-copia-accesso').onclick = async () => {
          const { url } = await api.portale.get();
          const testo = `Indirizzo: ${url || '(indirizzo del portale)'}\nNome utente: ${form.elements.portale_utente.value}\nPassword: ${pw.value || '(quella già comunicata)'}`;
          await navigator.clipboard.writeText(testo);
          toast('Dati di accesso copiati');
        };
        api.portale.get().then(async ({ url }) => {
          const righe = [url ? `Indirizzo del portale: <strong>${esc(url)}</strong>` : 'Indirizzo del portale non ancora impostato (Impostazioni → Portale web).'];
          if (cliente?.portale_utente) {
            const acc = await api.portale.accessi(cliente.portale_utente).catch(() => []);
            const ok = acc.find((a) => a.riuscito);
            righe.push(ok ? `Ultimo accesso: ${fmtDateTime(ok.quando)}` : 'Nessun accesso finora.');
          }
          $('#portale-dettagli').innerHTML = righe.join('<br>');
        });
      }
    },
    onSubmit: async (d) => {
      const data = { ...d };
      if (!data.portale_password) delete data.portale_password;
      const saved = cliente ? await api.clienti.update(cliente.id, data) : await api.clienti.create(data);
      toast(cliente ? 'Cliente aggiornato' : 'Cliente creato (database dedicato pronto)');
      await loadClienti();
      go({ name: 'cliente', id: saved.id, tab: route.tab });
    }
  });
}

// Ordine in cui le sezioni compaiono (nel modulo e come schede nella pagina del cliente)
const SEZIONI_ORDINE = ['anagrafica', 'appuntamenti', 'servizi', 'pagamenti', 'fatture', 'acquisti'];

const SECTIONS = {
  // Sezioni ancora da definire: mostrano un segnaposto finché non vengono realizzate
  servizi: {
    label: 'Servizi',
    descrizione: 'Servizi offerti e loro durata',
    placeholder: true
  },
  appuntamenti: {
    label: 'Appuntamenti',
    descrizione: 'Agenda degli appuntamenti',
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
    descrizione: 'Fatture emesse, IVA e incassi',
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
    descrizione: 'Spese e acquisti dai fornitori',
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
  const cliente = await safe(() => api.clienti.get(route.id));
  if (!cliente) return go({ name: 'home' });
  const attive = SEZIONI_ORDINE.filter((k) => (cliente.sezioni || []).includes(k));
  const tab = attive.includes(route.tab) ? route.tab : attive[0];
  route.tab = tab;

  content.classList.add('cliente-page');
  content.style.setProperty('--cliente', cliente.colore);
  content.style.setProperty('--on-cliente', textOn(cliente.colore));

  content.innerHTML = `
    <div class="cliente-header">
      <div class="cliente-title">
        ${logoCliente(cliente, 'logo-lg')}
        <div>
        <h1>${esc(cliente.nome)}</h1>
        <div class="subtitle">${[cliente.email, cliente.telefono, cliente.partita_iva].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn" id="btn-edit-cliente">Modifica</button>
        <button class="btn danger" id="btn-archive-cliente">Archivia</button>
      </div>
    </div>
    <div class="tabs">
      ${attive
        .map((k) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${SECTIONS[k].label}</button>`)
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
  content.querySelectorAll('.tab').forEach((b) => (b.onclick = () => go({ name: 'cliente', id: route.id, tab: b.dataset.tab })));
  badgeSchede();

  await renderSection(cliente, tab);
}

async function renderSection(cliente, table) {
  const s = SECTIONS[table];
  const el = $('#section');
  if (s.render) return s.render(cliente, el);
  if (s.placeholder) {
    el.innerHTML = `<div class="panel placeholder">
      <h3>${esc(s.label)}</h3>
      <p class="muted">${esc(s.descrizione)}.<br>Questa sezione è attiva per ${esc(cliente.nome)} ma non è ancora stata realizzata.</p>
    </div>`;
    return;
  }
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
  const em = await api.email.get();
  const portale = await api.portale.get();
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
      <h3>Email per i promemoria</h3>
      <p class="muted">I promemoria via email di tutti i clienti partono da questa casella. Il nome del mittente si imposta per ogni cliente.
        Per Gmail serve una <strong>password per le app</strong> (non la password normale):
        Account Google → Sicurezza → Verifica in due passaggi (attiva) → <em>Password per le app</em> → crea “Zuk Gestionale” e copia il codice di 16 lettere.</p>
      <form id="email-form" class="form-grid">
        <label>Indirizzo Gmail<input name="user" type="email" value="${esc(em.user)}" placeholder="nome@gmail.com" required></label>
        <label>Password per le app<input name="password" type="password" placeholder="${em.haPassword ? '•••••••• (salvata, lascia vuoto per non cambiarla)' : 'xxxx xxxx xxxx xxxx'}"></label>
        <label>Orario di invio promemoria<input name="orario" type="time" value="${esc(em.orario || '12:00')}" required></label>
        <details class="full"><summary class="muted">Altro provider (non Gmail)</summary>
          <div class="form-grid" style="margin-top:8px">
            <label>Server SMTP<input name="host" value="${esc(em.host)}"></label>
            <label>Porta<input name="port" type="number" value="${esc(em.port)}"></label>
            <label class="check full"><input type="checkbox" name="secure" ${em.secure ? 'checked' : ''}> Connessione SSL</label>
          </div>
        </details>
        <div class="btn-row full">
          <button type="button" class="btn" id="btn-email-prova">Invia email di prova a me stesso</button>
          <button type="submit" class="btn primary">Salva</button>
        </div>
      </form>
      <p class="muted small">La password resta solo su questo computer, cifrata. Email e WhatsApp partono dall'orario indicato, 5 giorni lavorativi prima di ogni scadenza, se l'app è aperta.</p>
    </div>
    <div class="panel">
      <h3>Portale web per i clienti</h3>
      <p class="muted">Il sito dove i tuoi clienti consultano i loro dati in sola lettura (senza campi sanitari).
        Le credenziali di ogni cliente si impostano in “Modifica cliente”.</p>
      <form id="portale-form" class="form-grid">
        <label class="full">Indirizzo del portale<input name="url" type="url" value="${esc(portale.url)}" placeholder="https://nome-progetto.vercel.app"></label>
        <div class="btn-row full">
          <button type="submit" class="btn">Salva indirizzo</button>
          ${portale.url ? `<a class="btn" href="${esc(portale.url)}" id="apri-portale">Apri il portale</a>` : ''}
          <button type="button" class="btn" id="btn-accesso-db">Genera accesso al database per Vercel</button>
        </div>
      </form>
      <div id="accesso-db"></div>
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
  $('#portale-form').onsubmit = async (e) => {
    e.preventDefault();
    await safe(() => api.portale.saveUrl(e.target.url.value));
    toast('Indirizzo salvato');
    renderSettings();
  };
  if ($('#apri-portale')) $('#apri-portale').onclick = (e) => { e.preventDefault(); api.apriLink(portale.url); };
  $('#btn-accesso-db').onclick = async () => {
    if (!confirm('Generare un nuovo accesso al database per il portale? Se il portale è già online, dovrai aggiornare DATABASE_URL su Vercel.')) return;
    const r = await safe(() => api.portale.accessoDb());
    $('#accesso-db').innerHTML = `<div class="accesso-db">
      <p><strong>Copia questi due valori su Vercel</strong> (Settings → Environment Variables). Non vengono salvati qui: se li perdi, generane di nuovi.</p>
      <label>DATABASE_URL<textarea readonly rows="2">${esc(r.databaseUrl)}</textarea></label>
      <label>SESSION_SECRET<textarea readonly rows="1">${esc(r.sessionSecret)}</textarea></label>
    </div>`;
    $('#accesso-db').querySelectorAll('textarea').forEach((t) => (t.onclick = () => { t.select(); navigator.clipboard.writeText(t.value); toast('Copiato'); }));
  };
  const ef = $('#email-form');
  const leggiEmail = () => ({
    user: ef.user.value.trim(), password: ef.password.value, orario: ef.orario.value,
    host: ef.host.value.trim() || 'smtp.gmail.com', port: Number(ef.port.value) || 465, secure: ef.secure.checked
  });
  ef.onsubmit = async (e) => {
    e.preventDefault();
    await safe(() => api.email.save(leggiEmail()));
    toast('Impostazioni email salvate');
    renderSettings();
  };
  $('#btn-email-prova').onclick = async () => {
    const d = leggiEmail();
    if (!d.user) return toast('Inserisci l\'indirizzo Gmail', true);
    toast('Invio in corso…');
    try {
      await api.email.prova(d);
      toast(`Email di prova inviata a ${d.user}: controlla la posta`);
    } catch (err) {
      toast('Invio non riuscito: ' + err.message, true);
    }
  };
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

// ---------- WhatsApp Web ----------------------------------------------------
let waStato = { stato: 'disconnesso' };
const waDialog = $('#wa-dialog');

function formattaNumero(n) {
  return n ? '+' + n.replace(/^(\d{2})(\d{3})(\d+)$/, '$1 $2 $3') : '';
}

function aggiornaWhatsApp(st) {
  waStato = st;
  const btn = $('#wa-btn');
  btn.className = 'wa-status ' + st.stato;
  $('#wa-label').textContent = {
    connesso: `WhatsApp connesso${st.numero ? ' · ' + formattaNumero(st.numero) : ''}`,
    qr: 'In attesa della scansione…',
    connessione: 'Collegamento WhatsApp…',
    disconnesso: 'Connetti WhatsApp Web'
  }[st.stato];
  if (waDialog.open) disegnaDialogWhatsApp();
}

function disegnaDialogWhatsApp() {
  const st = waStato;
  const body = $('#wa-body');
  const actions = $('#wa-actions');
  if (st.stato === 'connesso') {
    body.innerHTML = `<div class="wa-ok">✅ Connesso come <strong>${esc(formattaNumero(st.numero))}</strong></div>
      <p class="muted">I promemoria WhatsApp partono in automatico dall'orario impostato. Se l'app è chiusa o WhatsApp è disconnesso, i messaggi restano in attesa e partono al prossimo collegamento.</p>`;
    actions.innerHTML = '<button class="btn danger" id="wa-logout">Disconnetti</button><button class="btn primary" id="wa-close">Chiudi</button>';
  } else if (st.stato === 'qr' && st.qr) {
    body.innerHTML = `<div class="wa-qr"><img src="${st.qr}" alt="QR code"></div>
      <ol class="wa-steps"><li>Apri WhatsApp sul telefono</li><li>Tocca <strong>⋮</strong> o <strong>Impostazioni</strong> → <strong>Dispositivi collegati</strong></li>
      <li>Tocca <strong>Collega un dispositivo</strong> e inquadra il codice</li></ol>`;
    actions.innerHTML = '<button class="btn" id="wa-cancel">Annulla</button>';
  } else if (st.stato === 'connessione') {
    body.innerHTML = '<p class="muted">Collegamento in corso…</p>';
    actions.innerHTML = '<button class="btn" id="wa-cancel">Annulla</button>';
  } else {
    body.innerHTML = `${st.errore ? `<p class="late-days">${esc(st.errore)}</p>` : ''}
      <p>Collega il WhatsApp da cui inviare i promemoria. Finché non è connesso, i messaggi WhatsApp non partono.</p>
      <p class="muted small">Il collegamento usa WhatsApp Web come “dispositivo collegato”. Non è un servizio ufficiale di Meta: usalo solo per messaggi a persone che ti conoscono, senza invii di massa.</p>`;
    actions.innerHTML = '<button class="btn" id="wa-close">Chiudi</button><button class="btn primary" id="wa-connect">Mostra QR code</button>';
  }
  const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
  on('wa-close', () => waDialog.close());
  on('wa-connect', () => safe(() => api.whatsapp.connetti()));
  on('wa-cancel', async () => { await api.whatsapp.annulla(); waDialog.close(); });
  on('wa-logout', async () => {
    if (!confirm('Disconnettere WhatsApp? Per ricollegarlo dovrai scansionare di nuovo il QR code.')) return;
    await safe(() => api.whatsapp.disconnetti());
  });
}

$('#wa-btn').onclick = async () => {
  disegnaDialogWhatsApp();
  waDialog.showModal();
  if (waStato.stato === 'disconnesso') safe(() => api.whatsapp.connetti());
};
api.whatsapp.onStato((st) => {
  const prima = waStato.stato;
  aggiornaWhatsApp(st);
  if (st.stato === 'connesso' && prima !== 'connesso') {
    toast('WhatsApp connesso');
    setTimeout(() => waDialog.open && waStato.stato === 'connesso' && waDialog.close(), 2500);
  }
});

// ---------- Avvio -----------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  const info = await api.appInfo();
  $('#app-version').textContent = info.version;
  api.whatsapp.stato().then(aggiornaWhatsApp).catch(() => {});
  await loadClienti();
  go({ name: info.dbReady ? 'home' : 'settings' });
  // all'apertura: notifica di sistema se ci sono rate in ritardo
  if (info.dbReady) {
    const d = await aggiornaRitardi();
    const n = d ? d.ritardi.reduce((s, r) => s + r.rate.length, 0) : 0;
    if (n) {
      const nomi = d.ritardi.slice(0, 3).map((r) => r.persona_nome).join(', ') + (d.ritardi.length > 3 ? '…' : '');
      const notifica = new Notification(`${n} ${n === 1 ? 'rata in ritardo' : 'rate in ritardo'}`, { body: nomi });
      notifica.onclick = () => go({ name: 'home' });
    }
  }
});
