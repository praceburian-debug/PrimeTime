/**
 * POST /api/send-comment
 *
 * Tento endpoint volá POUZE QStash v naplánovaný čas.
 * Přímé volání bez platného QStash podpisu je odmítnuto.
 *
 * Body (posílá QStash): { jobId, memberId, cardId }
 *
 * Endpoint:
 *   1. Ověří QStash podpis (bezpečnost)
 *   2. Načte metadata jobu z Redis (text komentáře)
 *   3. Načte zašifrovaný token člena z Redis
 *   4. Dešifruje token
 *   5. Odešle komentář Trello REST API
 *   6. Aktualizuje status jobu na 'sent'
 */

import { Receiver }    from '@upstash/qstash';
import { redis, KEYS } from '../lib/redis.js';
import { decrypt }     from '../lib/crypto.js';
import { postComment } from '../lib/trello.js';

export const config = { runtime: 'edge' };

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey:    process.env.QSTASH_NEXT_SIGNING_KEY,
});

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // ── Ověř QStash podpis ────────────────────────────────────────
  // Bez tohoto by kdokoliv mohl odeslat komentář zavoláním endpointu přímo
  const rawBody  = await req.text();
  const signature = req.headers.get('upstash-signature') || '';

  let isValid = false;
  try {
    isValid = await receiver.verify({
      signature,
      body: rawBody,
      clockTolerance: 5, // 5 sekund tolerance pro clock skew
    });
  } catch (err) {
    console.error('QStash signature verification failed:', err);
  }

  if (!isValid) {
    return new Response('Unauthorized – invalid QStash signature', { status: 401 });
  }

  // ── Parsuj body ───────────────────────────────────────────────
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { jobId, memberId, cardId } = payload;
  if (!jobId || !memberId || !cardId) {
    return new Response('Chybí jobId, memberId nebo cardId', { status: 400 });
  }

  // ── Načti metadata jobu ───────────────────────────────────────
  const jobRaw = await redis.get(KEYS.job(jobId));
  if (!jobRaw) {
    // Job neexistuje — mohl být zrušen uživatelem nebo vypršel TTL
    console.warn(`Job ${jobId} nenalezen v Redis — pravděpodobně zrušen`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;

  // Kontrola statusu — pokud byl job zrušen, přeskoč
  if (job.status === 'cancelled') {
    console.log(`Job ${jobId} byl zrušen, přeskakuji`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Načti a dešifruj token ────────────────────────────────────
  const encryptedToken = await redis.get(KEYS.memberToken(memberId));
  if (!encryptedToken) {
    // Token byl odvolán — označ job jako failed
    await redis.set(KEYS.job(jobId), JSON.stringify({
      ...job, status: 'failed', failReason: 'Token odvolán',
      failedAt: new Date().toISOString(),
    }), { ex: 48 * 3600 });
    console.error(`Token pro ${memberId} nenalezen — job ${jobId} failed`);
    return new Response('Token nenalezen', { status: 200 }); // 200 aby QStash neopakoval
  }

  let memberToken;
  try {
    memberToken = decrypt(typeof encryptedToken === 'string' ? encryptedToken : String(encryptedToken));
  } catch (err) {
    console.error(`Chyba při dešifrování tokenu pro ${memberId}:`, err);
    await updateJobStatus(job, jobId, 'failed', 'Chyba dešifrování');
    return new Response('Decryption error', { status: 200 });
  }

  // ── Odešli komentář ───────────────────────────────────────────
  try {
    await postComment(cardId, job.text, memberToken);

    // Aktualizuj status jobu
    await redis.set(KEYS.job(jobId), JSON.stringify({
      ...job,
      status: 'sent',
      sentAt: new Date().toISOString(),
    }), { ex: 48 * 3600 });

    // Odstraň jobId ze setu aktivních jobů člena
    await redis.srem(KEYS.memberJobs(memberId), jobId);

    console.log(`✓ Job ${jobId} — komentář odeslán na kartu ${cardId}`);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`Chyba při odesílání komentáře (job ${jobId}):`, err);
    await updateJobStatus(job, jobId, 'failed', err.message);
    // Vrátíme 500 → QStash to zkusí znovu (má retry logiku)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function updateJobStatus(job, jobId, status, reason) {
  await redis.set(KEYS.job(jobId), JSON.stringify({
    ...job, status, failReason: reason,
    failedAt: new Date().toISOString(),
  }), { ex: 48 * 3600 });
}
