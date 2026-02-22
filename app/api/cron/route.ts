import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getRedis } from '@/lib/redis';

const parser = new Parser();
const REDIS_KEY = 'daily_news';

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

  const genAI = new GoogleGenerativeAI(apiKey);

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

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from the response (Gemini sometimes adds markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse Gemini response as JSON');
    }
    
    const summarizedNews = JSON.parse(jsonMatch[0]);

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
