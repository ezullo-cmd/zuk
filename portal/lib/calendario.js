// Calendario lavorativo italiano: lunedì-venerdì, escluse le festività nazionali (Pasquetta compresa).
const pad = (n) => String(n).padStart(2, '0');
const isoUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function pasqua(y) {
  // algoritmo di Gauss/Meeus per la domenica di Pasqua
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mese - 1, giorno));
}

const FESTE_FISSE = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26'];

function festivo(d) {
  if (FESTE_FISSE.includes(isoUTC(d).slice(5))) return true;
  const pasquetta = pasqua(d.getUTCFullYear());
  pasquetta.setUTCDate(pasquetta.getUTCDate() + 1);
  return isoUTC(pasquetta) === isoUTC(d);
}

const lavorativo = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !festivo(d);

/** Ultimo giorno lavorativo del mese (m: 1-12) in formato 'YYYY-MM-DD'. */
function ultimoLavorativo(y, m) {
  const d = new Date(Date.UTC(y, m, 0));
  while (!lavorativo(d)) d.setUTCDate(d.getUTCDate() - 1);
  return isoUTC(d);
}

/** Data che cade N giorni lavorativi prima di `data` ('YYYY-MM-DD'). */
function giorniLavorativiPrima(data, giorni) {
  const d = new Date(data + 'T00:00:00Z');
  let n = 0;
  while (n < giorni) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (lavorativo(d)) n++;
  }
  return isoUTC(d);
}

module.exports = { pasqua, festivo, lavorativo, ultimoLavorativo, giorniLavorativiPrima };
