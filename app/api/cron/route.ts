import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { getRedis } from '@/lib/redis';

const parser = new Parser();
const REDIS_KEY = 'daily_news';
/** v1 → v1beta 순 엔드포인트 탐색, 각 모델은 기본명 + models/ 접두어 형식으로 재시도 (총 8회) */
const GEMINI_API_BASES = [
  'https://generativelanguage.googleapis.com/v1',
  'https://generativelanguage.googleapis.com/v1beta',
] as const;
const GEMINI_MODEL = 'gemini-3-flash';
const GEMINI_MODEL_ALT = 'models/gemini-3-flash';
const GEMINI_MODEL_25 = 'gemini-2.5-flash';
const GEMINI_MODEL_25_ALT = 'models/gemini-2.5-flash';

const RSS_FEEDS = [
  'https://news.google.com/rss/search?q=economy+stock+market&hl=en-US&gl=US&ceid=US:en', // US Finance
  'https://news.google.com/rss/search?q=%EA%B2%BD%EC%A0%9C+%EC%A3%BC%EC%8B%9D&hl=ko&gl=KR&ceid=KR:ko', // KR Finance
];

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  // 브라우저 주소창 직접 호출 시 ?secret=CRON_SECRET 값으로 인증
  const secretParam = req.nextUrl.searchParams.get('secret')?.trim();

  const headerOk = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
  const queryOk = Boolean(cronSecret && secretParam && secretParam === cronSecret);

  if (!headerOk && !queryOk) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error('GOOGLE_API_KEY is not set in environment variables');
    return NextResponse.json(
      { success: false, error: 'GOOGLE_API_KEY is not configured' },
      { status: 500 }
    );
  }

  try {
    const allNews = [];

    for (const url of RSS_FEEDS) {
      const feed = await parser.parseURL(url);
      const items = feed.items.slice(0, 5); // 5 items each
      allNews.push(...items.map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
      })));
    }

    const prompt = `
      You are a stock market expert. Summarize the following news items into a concise format for a "Stock Morning Brief".
      
      For each news item, provide:
      1. A 3-line summary in Korean.
      2. Relevant stock tickers (if any).
      
      Format the output as a JSON array of objects with the following structure:
      {
        "title": "Original news title",
        "link": "Original link",
        "summary": "3-line Korean summary here",
        "tickers": ["TICKER1", "TICKER2"]
      }

      News items:
      ${JSON.stringify(allNews)}
    `;

    type SummarizedItem = { title: string; link: string; summary: string; tickers: string[] };
    type GeminiGenerateResponse = {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    let summarizedNews: SummarizedItem[] | undefined;
    const modelIdsToTry = [GEMINI_MODEL, GEMINI_MODEL_ALT, GEMINI_MODEL_25, GEMINI_MODEL_25_ALT];
    let lastErr: unknown;

    for (const apiBase of GEMINI_API_BASES) {
      for (const modelId of modelIdsToTry) {
        const url = `${apiBase}/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            }),
          });

          if (!res.ok) {
            if (res.status === 404) {
              console.error('[Gemini 404] model:', modelId, '| API URL:', `${apiBase}/models/${modelId}:generateContent`);
            }
            const errBody = await res.text();
            lastErr = new Error(`Gemini API ${res.status}: ${errBody || res.statusText}`);
            continue;
          }

          const data = (await res.json()) as GeminiGenerateResponse;
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            lastErr = new Error('Failed to parse Gemini response as JSON');
            continue;
          }
          summarizedNews = JSON.parse(jsonMatch[0]) as SummarizedItem[];
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.error('Gemini API error (base:', apiBase, 'model:', modelId, '):', err);
        }
      }
      if (summarizedNews !== undefined) break;
    }

    if (summarizedNews === undefined) {
      console.error('Gemini API error (all models failed):', lastErr);
      throw lastErr;
    }

    // Save to Redis (REDIS_URL 사용)
    try {
      const redis = getRedis();
      await redis.set(
        REDIS_KEY,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          news: summarizedNews,
        })
      );
    } catch (redisErr) {
      const msg = redisErr instanceof Error ? redisErr.message : 'Redis connection failed';
      console.error('Redis failed:', msg);
      return NextResponse.json(
        { success: false, error: 'Redis is not configured. Set REDIS_URL.' },
        { status: 500 }
      );
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>뉴스 업데이트</title></head><body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:1rem;text-align:center;"><h1>뉴스 업데이트 성공!</h1><p>${summarizedNews.length}건이 반영되었습니다.</p></body></html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error: unknown) {
    console.error('Cron job error:', error);
    const rawMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    // Invalid URL 등 KV 관련 에러는 상세 내용 노출 방지
    const errorMessage =
      /redis|REDIS_URL|connection refused/i.test(rawMessage)
        ? 'Redis is not configured or unreachable. Set REDIS_URL.'
        : rawMessage;
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
