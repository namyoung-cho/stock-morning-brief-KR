import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { getRedis } from '@/lib/redis';
import { google } from 'googleapis';

const parser = new Parser();
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
/** v1 → v1beta 순 엔드포인트 탐색, 각 모델은 기본명 + models/ 접두어 형식으로 재시도 (총 8회) */
const GEMINI_API_BASES = [
  'https://generativelanguage.googleapis.com/v1',
  'https://generativelanguage.googleapis.com/v1beta',
] as const;

// 젬나이 모델 설정 (충돌 해결: 최신 모델명 유지)
const GEMINI_MODEL = 'gemini-1.5-flash'; // 안정적인 기본 모델
const GEMINI_MODEL_20 = 'gemini-2.0-flash'; // 최신 모델
const GEMINI_MODEL_30 = 'gemini-3.0-flash'; // 향후 대비 (현재는 404 가능성 있음)
const GEMINI_MODEL_25 = 'gemini-2.5-flash';

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
당신은 투자자용 모닝 브리프를 작성하는 전문가입니다. 아래 뉴스 목록에서 다음 규칙에 맞춰 분석해 주세요.

【뉴스 구성】
- 한국 경제 뉴스 Top 5개, 미국 경제 뉴스 Top 5개를 각각 선정할 것.
- 주어진 항목 중 한국 관련은 kr, 미국 관련은 us로 구분하여 각 5개씩만 선정할 것.

【출력 형식 (각 뉴스마다 준수)】
- **[뉴스 제목]**을 반드시 포함할 것.
- 해당 뉴스를 3줄 이내로 요약할 것.
- 이 뉴스에 영향을 받는 관련 기업명을 명시할 것.

【톤앤매너】
- 투자자에게 도움이 되도록 전문적이고 간결한 말투를 사용할 것.

【결과물 구조】
반드시 아래 JSON 형태로만 출력할 것. 다른 설명이나 마크다운 없이 JSON만 출력.

{
  "kr": [
    { "title": "뉴스 제목", "link": "기사 URL", "summary": "3줄 이내 요약", "relatedCompanies": ["기업1", "기업2"] }
  ],
  "us": [
    { "title": "뉴스 제목", "link": "기사 URL", "summary": "3줄 이내 요약", "relatedCompanies": ["기업1", "기업2"] }
  ]
}

- kr 배열에는 한국 주요 경제 뉴스 Top 5, us 배열에는 미국 주요 경제 뉴스 Top 5를 넣을 것.
- 각 뉴스의 summary는 **[제목]**에 이어서 요약 문장만 작성해도 되고, relatedCompanies는 해당 뉴스에 영향을 받는 기업명(한글 또는 영문) 배열로 넣을 것.

뉴스 원본 목록:
${JSON.stringify(allNews)}
`;

    type GeminiBriefRaw = {
      kr: Array<{
        title: string;
        link: string;
        summary: string;
        relatedCompanies?: string[];
      }>;
      us: Array<{
        title: string;
        link: string;
        summary: string;
        relatedCompanies?: string[];
      }>;
    };
    type GeminiGenerateResponse = {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    let summarizedNews: SummarizedItem[] | undefined;
    const modelIdsToTry = [
      GEMINI_MODEL,
      GEMINI_MODEL_20,
      GEMINI_MODEL_25,
      GEMINI_MODEL_30,
    ];
    let lastErr: unknown;

    for (const apiBase of GEMINI_API_BASES) {
      for (const modelId of modelIdsToTry) {
        // Ensure modelId has 'models/' prefix exactly once
        const normalizedModelId = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
        const url = `${apiBase}/${normalizedModelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
              console.error('[Gemini 404] model:', modelId, '| API URL:', `${apiBase}/${normalizedModelId}:generateContent`);
            }
            const errBody = await res.text();
            lastErr = new Error(`Gemini API ${res.status}: ${errBody || res.statusText}`);
            continue;
          }

          const data = (await res.json()) as GeminiGenerateResponse;
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            lastErr = new Error('Failed to parse Gemini response as JSON');
            continue;
          }
          const parsed = JSON.parse(jsonMatch[0]) as GeminiBriefRaw;
          if (!Array.isArray(parsed.kr) || !Array.isArray(parsed.us)) {
            lastErr = new Error('Gemini response missing kr or us array');
            continue;
          }
          const kr = parsed.kr.map((i) => ({
            title: i.title,
            link: i.link,
            summary: i.summary,
            tickers: i.relatedCompanies ?? [],
            section: 'kr' as const,
          }));
          const us = parsed.us.map((i) => ({
            title: i.title,
            link: i.link,
            summary: i.summary,
            tickers: i.relatedCompanies ?? [],
            section: 'us' as const,
          }));
          summarizedNews = [...kr, ...us];
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
      // 포스팅 직후 Blogger에 게시
      await postToBlogger(summarizedNews);
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
