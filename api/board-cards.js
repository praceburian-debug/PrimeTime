/**
 * GET /api/board-cards?boardId=xxx&memberId=xxx
 *
 * Načte živý stav karet z Trello REST API pomocí uloženého OAuth tokenu.
 * Vrátí karty ve sloupci "Probíhá" (nebo jiném zadaném) s počtem per člen.
 */

import { redis, KEYS } from '../lib/redis.js';
import { decrypt }     from '../lib/crypto.js';

const ALLOWED = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).end();

  const { boardId, memberId, listName = 'Probíhá' } = req.query || {};
  if (!boardId || !memberId) {
    return res.status(400).json({ error: 'Chybí boardId nebo memberId' });
  }

  // Načti OAuth token admina
  const encryptedToken = await redis.get(KEYS.memberToken(memberId));
  if (!encryptedToken) {
    return res.status(401).json({ error: 'Token nenalezen — autorizuj se přes PrimeTime', needsAuth: true });
  }

  let token;
  try { token = await decrypt(String(encryptedToken)); }
  catch (e) { return res.status(500).json({ error: 'Chyba dešifrování tokenu' }); }

  const key = process.env.TRELLO_API_KEY;

  try {
    // 1. Načti všechny listy nástěnky
    const listsRes = await fetch(
      `https://api.trello.com/1/boards/${boardId}/lists?key=${key}&token=${token}&fields=id,name`
    );
    if (!listsRes.ok) throw new Error('Trello lists: ' + listsRes.status);
    const lists = await listsRes.json();

    // 2. Najdi listy jejichž název obsahuje hledaný řetězec (case-insensitive)
    const targetLists = lists.filter(l =>
      l.name.toLowerCase().includes(listName.toLowerCase())
    );
    if (!targetLists.length) {
      return res.status(200).json({ cards: [], lists: lists.map(l => l.name), targetLists: [] });
    }

    // 3. Načti karty z těchto listů
    const allCards = [];
    for (const list of targetLists) {
      const cardsRes = await fetch(
        `https://api.trello.com/1/lists/${list.id}/cards?key=${key}&token=${token}&fields=id,name,idMembers,labels`
      );
      if (!cardsRes.ok) continue;
      const cards = await cardsRes.json();
      cards.forEach(c => allCards.push({
        id: c.id,
        name: c.name,
        listId: list.id,
        listName: list.name,
        memberIds: c.idMembers || [],
        labels: (c.labels || []).map(l => ({ name: l.name, color: l.color })),
      }));
    }

    return res.status(200).json({
      cards: allCards,
      targetLists: targetLists.map(l => l.name),
      allLists: lists.map(l => l.name),
    });
  } catch (e) {
    console.error('board-cards error:', e);
    return res.status(500).json({ error: e.message });
  }
}
