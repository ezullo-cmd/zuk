const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

contextBridge.exposeInMainWorld('api', {
  appInfo: () => call('app:info'),
  settings: {
    get: () => call('settings:get'),
    test: (db) => call('settings:test', db),
    save: (db) => call('settings:save', db)
  },
  dashboard: () => call('dashboard'),
  clienti: {
    list: (opts) => call('clienti:list', opts),
    get: (id) => call('clienti:get', id),
    create: (data) => call('clienti:create', data),
    update: (id, data) => call('clienti:update', id, data),
    archive: (id, archiviato) => call('clienti:archive', id, archiviato),
    remove: (id, nomeConferma) => call('clienti:delete', id, nomeConferma)
  },
  records: {
    list: (clienteId, table) => call('records:list', clienteId, table),
    create: (clienteId, table, data) => call('records:create', clienteId, table, data),
    update: (clienteId, table, id, data) => call('records:update', clienteId, table, id, data),
    remove: (clienteId, table, id) => call('records:delete', clienteId, table, id)
  },
  persone: {
    list: (clienteId) => call('persone:list', clienteId),
    get: (clienteId, id) => call('persone:get', clienteId, id),
    save: (clienteId, id, data) => call('persone:save', clienteId, id, data)
  },
  promemoria: {
    defaults: () => call('promemoria:default'),
    list: (clienteId) => call('promemoria:list', clienteId),
    daInviare: () => call('promemoria:daInviare'),
    check: () => call('promemoria:check'),
    segnaInviato: (clienteId, id) => call('promemoria:inviato', clienteId, id),
    rimettiInCoda: (clienteId, id) => call('promemoria:rimetti', clienteId, id),
    onAggiornati: (cb) => ipcRenderer.on('promemoria:aggiornati', (_e, esito) => cb(esito))
  },
  apriLink: (url) => ipcRenderer.invoke('app:apriLink', url),
  portale: {
    get: () => call('portale:get'),
    saveUrl: (url) => call('portale:saveUrl', url),
    accessoDb: () => call('portale:accessoDb'),
    accessi: (utente) => call('portale:accessi', utente),
    verifica: (clienteId, utente, password) => call('portale:verifica', clienteId, utente, password),
    sblocca: (utente) => call('portale:sblocca', utente)
  },
  email: {
    get: () => call('email:get'),
    save: (data) => call('email:save', data),
    prova: (data) => call('email:prova', data)
  },
  whatsapp: {
    stato: () => call('wa:stato'),
    connetti: () => call('wa:connetti'),
    annulla: () => call('wa:annulla'),
    disconnetti: () => call('wa:disconnetti'),
    onStato: (cb) => ipcRenderer.on('wa:stato', (_e, st) => cb(st))
  },
  rate: {
    list: (clienteId) => call('rate:list', clienteId)
  },
  percorsi: {
    save: (clienteId, id, data) => call('percorsi:save', clienteId, id, data),
    anteprima: (data) => call('percorsi:anteprima', data),
    tipi: (clienteId) => call('percorsi:tipi', clienteId),
    rimuoviTipo: (clienteId, nome) => call('percorsi:rimuoviTipo', clienteId, nome),
    elencoTipi: (clienteId) => call('percorsi:elencoTipi', clienteId),
    aggiungiTipo: (clienteId, nome) => call('percorsi:aggiungiTipo', clienteId, nome),
    rinominaTipo: (clienteId, vecchio, nuovo) => call('percorsi:rinominaTipo', clienteId, vecchio, nuovo),
    ripristinaTipo: (clienteId, nome) => call('percorsi:ripristinaTipo', clienteId, nome)
  },
  pagamenti: {
    save: (clienteId, data, file) => call('pagamenti:save', clienteId, data, file)
  },
  documenti: {
    upload: (clienteId, personaId, file, descr) => call('documenti:upload', clienteId, personaId, file, descr),
    open: (clienteId, id) => call('documenti:open', clienteId, id),
    remove: (clienteId, id) => call('documenti:delete', clienteId, id)
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onEvent: (cb) => ipcRenderer.on('updater:event', (_e, ev) => cb(ev))
  }
});
