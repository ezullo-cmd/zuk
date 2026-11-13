# Portale clienti (sola lettura)

Sito dove ogni cliente consulta i suoi dati: riepilogo, anagrafica (senza dati sanitari),
appuntamenti, pagamenti e rate con le contabili, fatturazione e acquisti — solo le sezioni attive per lui.

- `public/` — interfaccia (si può aggiungere alla schermata Home del telefono)
- `api/` — funzioni server (login, dati, contabili)
- `lib/` — calcoli condivisi con l'app desktop

## Sicurezza
- Il portale usa l'utente del database **zuk_portale**, in sola lettura: non può vedere i campi sanitari
  (patologie, certificato medico, altezza, peso) né le impostazioni email, e non può modificare nulla.
- Le password dei clienti sono salvate come impronta (scrypt), mai in chiaro.
- Dopo 5 tentativi sbagliati in 15 minuti l'accesso si blocca; la sessione scade dopo 30 minuti di inattività.
- Si vedono solo le contabili allegate ai pagamenti, non gli altri documenti.

## Pubblicazione su Vercel (una volta sola)
1. Nell'app desktop: **Impostazioni → Portale web → Genera accesso al database per Vercel**. Copia i due valori.
2. Su [vercel.com](https://vercel.com) entra con GitHub → **Add New… → Project** → importa il repository `zuk`.
3. **Root Directory**: `portal` · **Framework Preset**: Other.
4. **Environment Variables**: `DATABASE_URL` e `SESSION_SECRET` con i valori copiati.
5. **Deploy**. Copia l'indirizzo (es. `https://zuk-xxx.vercel.app`) in **Impostazioni → Portale web → Indirizzo**.

Da quel momento ogni modifica pubblicata sul repository aggiorna anche il portale.

## Credenziali dei clienti
In **Modifica cliente → Portale web**: spunta l'accesso, scegli nome utente e password
(“Genera password”), salva e usa “Copia dati di accesso” per mandarli al cliente.
