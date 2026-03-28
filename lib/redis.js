import { Redis } from '@upstash/redis';

// Singleton Redis klient – Vercel ho reuse-uje přes warm invocations
export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/*
  Redis key schéma:
    token:{memberId}          → zašifrovaný OAuth token člena
    scheduled:{jobId}         → metadata naplánovaného komentáře
    member:{memberId}:jobs    → SET job ID všech jobů člena (pro přehled / revoke)
*/

export const KEYS = {
  memberToken: (memberId) => `token:${memberId}`,
  job:         (jobId)    => `scheduled:${jobId}`,
  memberJobs:  (memberId) => `member:${memberId}:jobs`,
};
