/**
 * GET /api/migrate?secret=xxx
 * Dočasný endpoint — jednou spustí migraci indexů. Po migraci soubor smaž.
 * Vyžaduje env MIGRATE_SECRET; bez něj endpoint nic nespustí.
 */

import { migrateIndexes } from '../lib/migrate.js';

export default async function handler(req, res) {
  const secret = process.env.MIGRATE_SECRET;
  if (!secret) return res.status(503).json({ error: 'MIGRATE_SECRET není nastavený (nebo chybí redeploy)' });
  if ((req.query || {}).secret !== secret) return res.status(401).json({ error: 'Špatný secret' });

  try {
    const result = await migrateIndexes();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('migrate error:', e);
    return res.status(500).json({ error: e.message });
  }
}
