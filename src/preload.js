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
    archive: (id, archiviato) => call('clienti:archive', id, archiviato)
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
  rate: {
    list: (clienteId) => call('rate:list', clienteId)
  },
  percorsi: {
    save: (clienteId, id, data) => call('percorsi:save', clienteId, id, data)
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
