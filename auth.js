/**
 * POST /api/auth
 *
 * Power-Up zavolá tento endpoint po tom co uživatel odklikne OAuth.
 * Body: { memberId, token }
 *
 * Endpoint:
 *   1. Ověří token voláním Trello /members/me
 *   2. Zašifruje token
 *   3. Uloží do Redis s TTL 1 rok
 *   4. Vrátí { ok: true, memberName }
 */

import { redis, KEYS }  from '../lib/redis.js';
import { encrypt }      from '../lib/crypto.js';
import { getMember }    from '../lib/trello.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // CORS — povolíme jen z GitHub Pages domény Power-Upu
  const origin = req.headers.get('origin') || '';
  const allowed = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';
  if (!origin.startsWith(allowed)) {
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { memberId, token } = body;
  if (!memberId || !token) {
    return new Response(JSON.stringify({ error: 'Chybí memberId nebo token' }), {
      status: 400, headers: corsHeaders(allowed),
    });
  }

  try {
    // Ověř token u Trella
    const member = await getMember(token);
    if (member.id !== memberId) {
      return new Response(JSON.stringify({ error: 'Token nepatří tomuto členovi' }), {
        status: 403, headers: corsHeaders(allowed),
      });
    }

    // Zašifruj a ulož do Redis, TTL = 365 dní
    const encrypted = encrypt(token);
    await redis.set(KEYS.memberToken(memberId), encrypted, { ex: 60 * 60 * 24 * 365 });

    return new Response(JSON.stringify({ ok: true, memberName: member.fullName }), {
      status: 200, headers: corsHeaders(allowed),
    });
  } catch (err) {
    console.error('auth error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders(allowed),
    });
  }
}

function corsHeaders(allowed) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
