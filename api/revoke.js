/**
 * POST /api/revoke
 *
 * Uživatel odvolá svůj OAuth token a zruší všechny čekající joby.
 * Body: { memberId, token }  ← token slouží jako ověření identity
 *
 * Pozn: QStash joby nelze "odvolat" na straně QStash (free tier tuto API nemá),
 * ale označíme je jako 'cancelled' v Redis. send-comment.js je pak přeskočí.
 */

import { redis, KEYS } from '../lib/redis.js';
import { getMember }   from '../lib/trello.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsH() });
  if (req.method !== 'POST')    return new Response('Method Not Allowed', { status: 405 });

  const origin  = req.headers.get('origin') || '';
  const allowed = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';
  if (!origin.startsWith(allowed)) return new Response('Forbidden', { status: 403 });

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, allowed); }

  const { memberId, token } = body;
  if (!memberId || !token) return json({ error: 'Chybí memberId nebo token' }, 400, allowed);

  // Ověř identitu — token musí patřit tomuto memberId
  try {
    const member = await getMember(token);
    if (member.id !== memberId) return json({ error: 'Neoprávněný přístup' }, 403, allowed);
  } catch {
    return json({ error: 'Neplatný Trello token' }, 401, allowed);
  }

  // Zruš všechny čekající joby tohoto člena
  const jobIds = await redis.smembers(KEYS.memberJobs(memberId));
  let cancelledCount = 0;

  for (const jobId of jobIds) {
    const jobRaw = await redis.get(KEYS.job(jobId));
    if (!jobRaw) continue;
    const job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;
    if (job.status === 'scheduled') {
      await redis.set(KEYS.job(jobId), JSON.stringify({
        ...job, status: 'cancelled', cancelledAt: new Date().toISOString(),
      }), { ex: 48 * 3600 });
      cancelledCount++;
    }
  }

  // Smaž token a set jobů
  await redis.del(KEYS.memberToken(memberId));
  await redis.del(KEYS.memberJobs(memberId));

  return json({ ok: true, cancelledJobs: cancelledCount }, 200, allowed);
}

function json(body, status, allowed) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...corsH(allowed) },
  });
}
function corsH(allowed = '*') {
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
