/**
 * POST /api/schedule
 * Naplánuje komentář přes QStash
 */

import { redis, KEYS } from '../lib/redis.js';
import { Client }      from '@upstash/qstash';

const qstash = new Client({ token: process.env.QSTASH_TOKEN });

export default async function handler(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const { memberId, cardId, cardName, text, sendAt } = req.body || {};
  if (!memberId || !cardId || !text || !sendAt) {
    return res.status(400).json({ error: 'Chybí povinná pole: memberId, cardId, text, sendAt' });
  }

  const storedToken = await redis.get(KEYS.memberToken(memberId));
  if (!storedToken) {
    return res.status(401).json({ error: 'Token nenalezen. Uživatel se musí autorizovat.', needsAuth: true });
  }

  const sendAtMs  = new Date(sendAt).getTime();
  const delayMs   = sendAtMs - Date.now();
  if (delayMs < 0) return res.status(400).json({ error: 'sendAt je v minulosti' });
  if (delayMs > 7 * 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'Max 7 dní dopředu' });

  const delaySeconds = Math.ceil(delayMs / 1000);
  const jobId        = crypto.randomUUID();
  const backendUrl   = process.env.BACKEND_URL;

  try {
    const qRes = await qstash.publishJSON({
      url:   `${backendUrl}/api/send-comment`,
      delay: delaySeconds,
      body:  { jobId, memberId, cardId },
    });

    const ttlSecs = delaySeconds + 48 * 3600;
    await redis.set(KEYS.job(jobId), JSON.stringify({
      jobId, memberId, cardId,
      cardName: cardName || cardId,
      text, sendAt,
      createdAt:   new Date().toISOString(),
      qstashMsgId: qRes.messageId,
      status:      'scheduled',
    }), { ex: ttlSecs });

    await redis.sadd(KEYS.memberJobs(memberId), jobId);

    return res.status(200).json({ ok: true, jobId, scheduledFor: sendAt });
  } catch (err) {
    console.error('schedule error:', err);
    return res.status(500).json({ error: err.message });
  }
}
