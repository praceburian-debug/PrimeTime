/**
 * POST /api/schedule
 *
 * Power-Up zavolá tento endpoint když uživatel klikne "Naplánovat komentář".
 * Body: { memberId, cardId, cardName, text, sendAt }
 *   sendAt = ISO 8601 string, např. "2026-04-01T14:30:00Z"
 *
 * Endpoint:
 *   1. Ověří že pro memberId existuje uložený token
 *   2. Vypočítá delay v sekundách
 *   3. Zavolá QStash s URL /api/send-comment a daným delay
 *   4. Uloží metadata jobu do Redis
 *   5. Vrátí { ok: true, jobId, scheduledFor }
 */

import { redis, KEYS } from '../lib/redis.js';
import { Client }      from '@upstash/qstash';
import { randomUUID }  from 'crypto';

export const config = { runtime: 'edge' };

const qstash = new Client({ token: process.env.QSTASH_TOKEN });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const origin  = req.headers.get('origin') || '';
  const allowed = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';
  if (!origin.startsWith(allowed)) return new Response('Forbidden', { status: 403 });

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, allowed); }

  const { memberId, cardId, cardName, text, sendAt } = body;
  if (!memberId || !cardId || !text || !sendAt) {
    return json({ error: 'Chybí povinná pole: memberId, cardId, text, sendAt' }, 400, allowed);
  }

  // Ověř že uložený token pro tohoto člena existuje
  const storedToken = await redis.get(KEYS.memberToken(memberId));
  if (!storedToken) {
    return json({
      error: 'Token nenalezen. Uživatel se musí nejdřív autorizovat.',
      needsAuth: true,
    }, 401, allowed);
  }

  // Vypočítej delay
  const sendAtMs  = new Date(sendAt).getTime();
  const nowMs     = Date.now();
  const delayMs   = sendAtMs - nowMs;

  if (delayMs < 0) {
    return json({ error: 'sendAt je v minulosti' }, 400, allowed);
  }
  if (delayMs > 7 * 24 * 60 * 60 * 1000) {
    return json({ error: 'QStash podporuje max 7 dní dopředu' }, 400, allowed);
  }

  const delaySeconds = Math.ceil(delayMs / 1000);
  const jobId        = randomUUID();
  const backendUrl   = process.env.BACKEND_URL;

  try {
    // Zavolej QStash — ten za delaySeconds zavolá /api/send-comment
    const qRes = await qstash.publishJSON({
      url:   `${backendUrl}/api/send-comment`,
      delay: delaySeconds,
      body:  { jobId, memberId, cardId },
    });

    // Ulož metadata jobu do Redis (TTL = sendAt + 48h pro případ retry)
    const ttlSecs = Math.ceil(delayMs / 1000) + 48 * 3600;
    await redis.set(KEYS.job(jobId), JSON.stringify({
      jobId,
      memberId,
      cardId,
      cardName:    cardName || cardId,
      text,
      sendAt,
      createdAt:   new Date().toISOString(),
      qstashMsgId: qRes.messageId,
      status:      'scheduled',
    }), { ex: ttlSecs });

    // Přidej jobId do setu jobů tohoto člena
    await redis.sadd(KEYS.memberJobs(memberId), jobId);

    return json({ ok: true, jobId, scheduledFor: sendAt }, 200, allowed);
  } catch (err) {
    console.error('schedule error:', err);
    return json({ error: err.message }, 500, allowed);
  }
}

function json(body, status, allowed) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin':  allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
function optionsResponse() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
}
