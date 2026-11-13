// Campi visibili dal portale (devono coincidere con i permessi dell'utente "zuk_portale").
// Esclusi dalle persone i dati sanitari: patologie/infortuni, certificato medico, altezza, peso.
const PERSONE_VISIBILI = [
  'id', 'nome', 'cognome', 'data_nascita', 'sesso', 'codice_fiscale', 'telefono', 'email', 'indirizzo',
  'contatto_emergenza', 'obiettivo', 'livello', 'stato', 'data_inizio', 'data_fine', 'tipo_pagamento',
  'importo', 'metodo_pagamento', 'note', 'canale_comunicazione', 'creato_il'
];

const CLIENTI_VISIBILI = [
  'id', 'nome', 'logo', 'colore', 'sezioni', 'archiviato', 'db_name',
  'portale_attivo', 'portale_utente', 'portale_password_hash'
];

const TABELLE_CLIENTE = ['percorsi', 'pagamenti', 'appuntamenti', 'fatture', 'acquisti', 'documenti'];

module.exports = { PERSONE_VISIBILI, CLIENTI_VISIBILI, TABELLE_CLIENTE };
