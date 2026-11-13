const s = require('../lib/server');

module.exports = s.gestisci(async (req, res) => {
  s.impostaCookie(res, '', 0);
  s.invia(res, 200, { ok: true });
});
