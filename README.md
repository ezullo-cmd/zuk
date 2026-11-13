# Zuk Gestionale

App desktop (Electron) per gestire i clienti: **appuntamenti**, **fatturazione** e **acquisti**.

- Pagina iniziale (Home) con riepilogo: clienti, prossimi appuntamenti, fatture da incassare.
- Menù laterale con l'elenco dei clienti; per ogni cliente le schede Appuntamenti / Fatturazione / Acquisti.
- **PostgreSQL con un database per cliente** per la separazione dei dati:
  - `zuk_master` → anagrafica clienti
  - `zuk_cliente_<id>` → appuntamenti, fatture e acquisti di quel cliente (creato automaticamente quando aggiungi il cliente)
- **Aggiornamento automatico**: ad ogni push su `main` GitHub Actions crea una nuova versione; all'apertura l'app la rileva, mostra una notifica e la installa con un clic.

## Sviluppo

```bash
npm install
```

```bash
npm start
```

Al primo avvio vai su **Impostazioni** e inserisci i dati di connessione a Postgres.
L'utente Postgres deve poter creare database (`CREATEDB`), es.:

```sql
CREATE USER zuk WITH PASSWORD 'una-password' CREATEDB;
```

La configurazione viene salvata in `config.json` nella cartella dati dell'utente
(Windows: `%APPDATA%\Zuk Gestionale`).

### Usare Neon (Postgres online)

1. Su [console.neon.tech](https://console.neon.tech) crea un progetto (regione vicina, es. *Frankfurt*).
2. Nella dashboard premi **Connect**, **disattiva "Connection pooling"** e copia la stringa
   `postgresql://...neon.tech/neondb?sslmode=require`.
3. Nell'app: **Impostazioni** → incolla la stringa nel primo campo → **Prova connessione** → **Salva e connetti**.

L'utente principale di Neon (`neondb_owner`) può già creare database, quindi i database
`zuk_master` e `zuk_cliente_<id>` vengono creati automaticamente. Li vedi in Neon in *Branches → main → Databases*.
Nel piano gratuito Neon va in pausa quando non lo usi: la prima operazione dopo una pausa può impiegare qualche secondo.

## Struttura

```
src/
  main/main.js      processo principale, IPC
  main/db.js        Postgres: DB master + un DB per cliente, migrazioni
  main/updater.js   controllo e installazione aggiornamenti
  main/config.js    impostazioni locali
  preload.js        API esposte all'interfaccia (window.api)
  renderer/         interfaccia (HTML/CSS/JS)
.github/workflows/release.yml   build e rilascio automatici
```

### Modificare lo schema del database

In `src/main/db.js` aggiungi una nuova stringa SQL **in fondo** a `CLIENT_MIGRATIONS`
(o `MASTER_MIGRATIONS`). Non modificare quelle già esistenti: ogni DB tiene traccia della
versione in `schema_version` e applica solo le migrazioni mancanti, quindi tutti i database
dei clienti vengono aggiornati automaticamente alla prima apertura.

## Rilasci e aggiornamenti automatici

1. Fai push (o merge) su `main`.
2. Il workflow **Build & Release** crea la versione `1.0.<numero build>`, compila
   l'installer Windows (`.exe`) e Linux (`.AppImage`) e li pubblica come GitHub Release.
3. All'apertura (e ogni 30 minuti) l'app controlla le release: se c'è una versione nuova compare
   una notifica di sistema e un banner **"Aggiorna"** → download → **"Riavvia e installa"**.

La prima volta scarica e installa manualmente l'installer dalla pagina *Releases* del repository;
da lì in poi gli aggiornamenti sono automatici.

**Requisiti:**
- Il repository deve essere **pubblico** perché l'app possa leggere le release senza token.
  Se vuoi tenerlo privato, pubblica le release su un secondo repository pubblico
  (cambia `owner`/`repo` in `package.json` → `build.publish` e usa un token con permesso sul repo
  di destinazione) oppure su un server tuo (provider `generic`).
- In *Settings → Actions → General → Workflow permissions* deve essere attivo **Read and write**.
- macOS: per l'aggiornamento automatico serve la firma del codice (Apple Developer ID);
  in quel caso aggiungi `macos-latest` alla matrice del workflow.
- Windows: senza un certificato di firma, SmartScreen mostrerà un avviso alla prima installazione.
