import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { google } from 'googleapis';
import { GoogleGenerativeAI, DynamicRetrievalMode } from '@google/generative-ai';

const REDIS_KEY = 'daily_news';

type SummarizedItem = {
  title: string;
  link: string;
  summary: string;
  tickers: string[];
  section?: 'kr' | 'us';
};

async function postToBlogger(newsData: SummarizedItem[]) {
  try {
    const clientId = process.env.BLOGGER_CLIENT_ID;
    const clientSecret = process.env.BLOGGER_CLIENT_SECRET;
    const refreshToken = process.env.BLOGGER_REFRESH_TOKEN;
    const blogId = process.env.BLOGGER_BLOG_ID;

    if (!clientId || !clientSecret || !refreshToken || !blogId) {
      console.error('Missing Blogger configuration environment variables');
      return;
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const blogger = google.blogger({ version: 'v3', auth: oauth2Client });

    const today = new Date().toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const krNews = newsData.filter((item) => item.section === 'kr');
    const usNews = newsData.filter((item) => item.section === 'us');

    let htmlContent = `<h2>[한국 경제 뉴스]</h2><ul>`;
    krNews.forEach((item) => {
      htmlContent += `<li><strong><a href="${item.link}">${
        item.title
      }</a></strong><br/>${item.summary}<br/><em>관련 기업: ${item.tickers.join(
        ', '
      )}</em></li><br/>`;
    });
    htmlContent += `</ul>`;

    htmlContent += `<h2>[미국 경제 뉴스]</h2><ul>`;
    usNews.forEach((item) => {
      htmlContent += `<li><strong><a href="${item.link}">${
        item.title
      }</a></strong><br/>${item.summary}<br/><em>관련 기업: ${item.tickers.join(
        ', '
      )}</em></li><br/>`;
    });
    htmlContent += `</ul>`;

    await blogger.posts.insert({
      blogId: blogId,
      requestBody: {
        title: `[${today}] Morning News Brief - AI 경제 브리핑`,
        content: htmlContent,
      },
    });
    console.log('Successfully posted to Blogger');
  } catch (error) {
    console.error('Error posting to Blogger:', error);
  }
}

async function fetchNewsFromGemini(prompt: string, apiKey: string): Promise<any[]> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{ googleSearchRetrieval: {} } as any],
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
    }
  });

  const response = result.response;
  const text = response.text();
  
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : (parsed.news || []);
  } catch (e) {
    // Fallback if not pure JSON
    const jsonMatch = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed) ? parsed : (parsed.news || []);
    }
    throw new Error('Failed to parse JSON from Gemini');
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const secretParam = req.nextUrl.searchParams.get('secret')?.trim();

  const headerOk = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
  const queryOk = Boolean(cronSecret && secretParam && secretParam === cronSecret);

  if (!headerOk && !queryOk) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'Gemini API Key is not configured (checked GEMINI_API_KEY and GOOGLE_API_KEY)' }, { status: 500 });
  }

  try {
    const promptKr = `오늘 대한민국 주요 경제 및 증시 뉴스를 실시간으로 검색해서 가장 중요한 5가지를 요약해줘, 기사 하단에 관련 기업중 주도적인 기업의 이름도 추가해줘.
결과는 반드시 다음과 같은 JSON 형식의 배열로만 응답해줘. 다른 설명은 생략해.
[
  { "title": "뉴스 제목", "link": "기사 URL", "summary": "요약 내용", "relatedCompanies": ["기업1", "기업2"] }
]`;

    const promptUs = `Today, search for and summarize the 5 most important real-time major economic and stock market news from the United States. Include leading related companies for each news.
Response must be only a JSON array in the following format. Do not include any other text.
[
  { "title": "News Title", "link": "Article URL", "summary": "Summary text", "relatedCompanies": ["Company1", "Company2"] }
]`;

    const [krRaw, usRaw] = await Promise.all([
      fetchNewsFromGemini(promptKr, apiKey),
      fetchNewsFromGemini(promptUs, apiKey)
    ]);

    const summarizedNews: SummarizedItem[] = [
      ...krRaw.slice(0, 5).map(item => ({
        title: item.title,
        link: item.link,
        summary: item.summary,
        tickers: item.relatedCompanies || [],
        section: 'kr' as const
      })),
      ...usRaw.slice(0, 5).map(item => ({
        title: item.title,
        link: item.link,
        summary: item.summary,
        tickers: item.relatedCompanies || [],
        section: 'us' as const
      }))
    ];

    // Save to Redis
    const redis = getRedis();
    await redis.set(
      REDIS_KEY,
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        news: summarizedNews,
      })
    );

    // Post to Blogger
    await postToBlogger(summarizedNews);

    return NextResponse.json({
      success: true,
      count: summarizedNews.length,
      news: summarizedNews
    });

  } catch (error: any) {
    console.error('Cron job error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
