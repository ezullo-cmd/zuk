// Password del portale: impronta scrypt con sale casuale (mai salvate in chiaro).
const crypto = require('crypto');

const N = 16384, R = 8, P = 1, LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password).trim(), salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verificaPassword(password, salvata) {
  try {
    const [tipo, n, r, p, salt, hash] = String(salvata || '').split('$');
    if (tipo !== 'scrypt') return false;
    const atteso = Buffer.from(hash, 'base64');
    const calcolato = crypto.scryptSync(String(password).trim(), Buffer.from(salt, 'base64'), atteso.length, {
      N: Number(n), r: Number(r), p: Number(p)
    });
    return crypto.timingSafeEqual(atteso, calcolato);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verificaPassword };
