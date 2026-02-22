import Redis from 'ioredis';

let client: Redis | null = null;

/**
 * REDIS_URL 하나로 접속 (예: redis://default:비밀번호@호스트:포트 또는 rediss://...)
 * Redis Labs 등 TLS 사용 시 SSL 인증서 검증 완화로 연결 오류 방지
 */
export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }

  const isTls = url.startsWith('rediss://');
  client = new Redis(url, {
    ...(isTls && {
      tls: {
        rejectUnauthorized: false,
      },
    }),
    maxRetriesPerRequest: 3,
  });

  return client;
}
