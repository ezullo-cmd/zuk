// Accesso al portale: nome utente e password del cliente, con blocco dei tentativi ripetuti.
const { verificaPassword } = require('../lib/password');
const s = require('../lib/server');

const MAX_PER_UTENTE = 5; // tentativi sbagliati in 15 minuti
const MAX_PER_IP = 20;
// impronta fittizia: il tempo di risposta è uguale anche se l'utente non esiste
const FINTA = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

module.exports = s.gestisci(async (req, res) => {
  if (req.method !== 'POST') return s.invia(res, 405, { errore: 'Metodo non consentito' });
  const { utente, password } = await s.leggiCorpo(req);
  const u = String(utente || '').trim().toLowerCase().slice(0, 60);
  const ip = s.ipDi(req);
  if (!u || !password) return s.invia(res, 400, { errore: 'Inserisci nome utente e password' });

  const { rows: [t] } = await s.master().query(
    `SELECT count(*) FILTER (WHERE utente = $1)::int AS per_utente, count(*) FILTER (WHERE ip = $2)::int AS per_ip
       FROM portale_accessi WHERE NOT riuscito AND quando > now() - interval '15 minutes'`,
    [u, ip]
  );
  if (t.per_utente >= MAX_PER_UTENTE || t.per_ip >= MAX_PER_IP)
    return s.invia(res, 429, { errore: 'Troppi tentativi non riusciti: riprova tra 15 minuti' });

  const c = await s.clientePerUtente(u);
  const ok = verificaPassword(password, c?.portale_password_hash || FINTA) && !!c?.portale_attivo && !c.archiviato;
  await s.master().query('INSERT INTO portale_accessi (utente, ip, riuscito) VALUES ($1, $2, $3)', [u, ip, ok]);
  if (!ok) return s.invia(res, 401, { errore: 'Nome utente o password non corretti' });

  s.impostaCookie(res, s.creaToken(c), s.SESSIONE_MINUTI * 60);
  s.invia(res, 200, { ok: true });
});
