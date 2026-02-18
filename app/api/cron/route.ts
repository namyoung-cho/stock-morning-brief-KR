import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { kv } from '@vercel/kv';

const parser = new Parser();
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

const RSS_FEEDS = [
  'https://news.google.com/rss/search?q=economy+stock+market&hl=en-US&gl=US&ceid=US:en', // US Finance
  'https://news.google.com/rss/search?q=%EA%B2%BD%EC%A0%9C+%EC%A3%BC%EC%8B%9D&hl=ko&gl=KR&ceid=KR:ko', // KR Finance
];

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
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

    // Save to Vercel KV
    await kv.set('daily_news', {
      updatedAt: new Date().toISOString(),
      news: summarizedNews,
    });

    return NextResponse.json({ success: true, count: summarizedNews.length });
  } catch (error: unknown) {
    console.error('Cron job error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
