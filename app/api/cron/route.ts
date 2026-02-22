import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@vercel/kv';

const parser = new Parser();

function getKvClient() {
  const url = process.env.KV_REST_API_URL?.trim();
  const token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN must be set');
  }
  try {
    return createClient({ url, token });
  } catch {
    // Invalid URL 등 클라이언트 생성 실패 시 상세 에러 대신 안전한 메시지
    throw new Error('KV client could not be created. Check KV_REST_API_URL and KV_REST_API_TOKEN.');
  }
}

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

    // Save to Vercel KV (KV_REST_API_URL, KV_REST_API_TOKEN 사용)
    let kv;
    try {
      kv = getKvClient();
    } catch (kvErr) {
      const msg = kvErr instanceof Error ? kvErr.message : 'Invalid URL or missing KV env';
      console.error('KV client init failed:', msg);
      return NextResponse.json(
        { success: false, error: 'KV storage is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN.' },
        { status: 500 }
      );
    }
    await kv.set('daily_news', {
      updatedAt: new Date().toISOString(),
      news: summarizedNews,
    });

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
      /invalid url|KV_REST_API|KV storage/i.test(rawMessage) || rawMessage === 'Invalid URL'
        ? 'KV storage is not configured or invalid. Set KV_REST_API_URL and KV_REST_API_TOKEN.'
        : rawMessage;
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
