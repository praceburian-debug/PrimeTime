/**
 * Jednorázová migrace na nové indexy (card-logs:*, boards, card-total bez TTL).
 * Je idempotentní, dá se pustit opakovaně.
 */

import { redis, KEYS, mgetChunked } from './redis.js';

export async function migrateIndexes() {
  const boardKeys = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, { match: 'board-logs:*', count: 500 });
    boardKeys.push(...keys);
    cursor = String(next);
  } while (cursor !== '0');

  const totals = new Map();
  let indexed = 0, dangling = 0;

  for (const boardKey of boardKeys) {
    const boardId = boardKey.slice('board-logs:'.length);
    const entries = await redis.zrange(boardKey, 0, -1, { withScores: true });
    const ids = [], scores = [];
    for (let i = 0; i < entries.length; i += 2) { ids.push(entries[i]); scores.push(Number(entries[i + 1])); }

    const raws = ids.length ? await mgetChunked(ids.map(KEYS.log)) : [];
    const p = redis.pipeline();
    p.sadd(KEYS.boards, boardId);
    raws.forEach((raw, i) => {
      const log = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!log) { p.zrem(boardKey, ids[i]); dangling++; return; }
      p.zadd(KEYS.cardLogs(log.cardId), { score: scores[i], member: ids[i] });
      totals.set(log.cardId, (totals.get(log.cardId) || 0) + Math.round(Number(log.mins) || 0));
      indexed++;
    });
    await p.exec();
  }

  const cardIds = [...totals.keys()];
  for (let i = 0; i < cardIds.length; i += 500) {
    const p = redis.pipeline();
    cardIds.slice(i, i + 500).forEach(id => p.set(KEYS.cardTotal(id), totals.get(id)));
    await p.exec();
  }

  return { boards: boardKeys.length, indexed, cards: cardIds.length, dangling };
}
