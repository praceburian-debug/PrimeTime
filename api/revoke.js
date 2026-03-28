/**
 * POST /api/revoke
 * Odvolá token a zruší čekající joby
 */

import { redis, KEYS } from '../lib/redis.js';
import { getMember }   from '../lib/trello.js';

export default async function handler(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const { memberId, token } = req.body || {};
  if (!memberId || !token) return res.status(400).json({ error: 'Chybí memberId nebo token' });

  try {
    const member = await getMember(token);
    if (member.id !== memberId) return res.status(403).json({ error: 'Neoprávněný přístup' });
  } catch {
    return res.status(401).json({ error: 'Neplatný token' });
  }

  const jobIds = await redis.smembers(KEYS.memberJobs(memberId));
  let cancelledCount = 0;
  for (const jobId of jobIds) {
    const jobRaw = await redis.get(KEYS.job(jobId));
    if (!jobRaw) continue;
    const job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;
    if (job.status === 'scheduled') {
      await redis.set(KEYS.job(jobId), JSON.stringify({ ...job, status: 'cancelled', cancelledAt: new Date().toISOString() }), { ex: 48 * 3600 });
      cancelledCount++;
    }
  }

  await redis.del(KEYS.memberToken(memberId));
  await redis.del(KEYS.memberJobs(memberId));

  return res.status(200).json({ ok: true, cancelledJobs: cancelledCount });
}
