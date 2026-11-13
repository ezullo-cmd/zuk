// Apre una contabile (PDF o immagine) allegata a un pagamento. Gli altri documenti non sono accessibili.
const s = require('../lib/server');

module.exports = s.gestisci(async (req, res) => {
  const cliente = await s.autentica(req, res);
  if (!cliente) return;
  const sezioni = cliente.sezioni || [];
  if (!sezioni.includes('pagamenti') && !sezioni.includes('anagrafica')) return s.invia(res, 403, { errore: 'Non disponibile' });
  const id = Number(s.query(req).id);
  const { rows } = await s.pool(cliente.db_name).query(
    `SELECT d.nome_file, d.mime, d.dati FROM documenti d
      WHERE d.id = $1 AND EXISTS (SELECT 1 FROM pagamenti pg WHERE pg.documento_id = d.id)`,
    [id]
  );
  if (!rows.length) return s.invia(res, 404, { errore: 'Documento non trovato' });
  const d = rows[0];
  const nome = d.nome_file.replace(/[^\w.\- ]+/g, '_');
  res.statusCode = 200;
  res.setHeader('Content-Type', ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(d.mime) ? d.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(d.dati);
});
