import { getRedis } from '@/lib/redis';
import { Newspaper, TrendingUp, Calendar } from 'lucide-react';

interface NewsItem {
  title: string;
  link: string;
  summary: string;
  tickers: string[];
  section?: 'kr' | 'us';
}

interface DailyNews {
  updatedAt: string;
  news: NewsItem[];
}

export const dynamic = 'force-dynamic';

export default async function Home() {
  let data: DailyNews | null = null;
  try {
    const redis = getRedis();
    const raw = await redis.get('daily_news');
    if (raw) data = JSON.parse(raw) as DailyNews;
  } catch {
    // REDIS_URL 미설정 또는 연결 실패 시 뉴스 없음으로 표시
  }

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      <header className="max-w-4xl mx-auto pt-16 pb-8 px-6 border-b border-neutral-200">
        <div className="flex items-center gap-2 mb-4">
          <Newspaper className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold tracking-tight">Stock Morning Brief</h1>
        </div>
        <p className="text-neutral-500 flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          {data ? new Date(data.updatedAt).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }) : '업데이트 정보 없음'}
        </p>
      </header>

      <div className="max-w-4xl mx-auto py-12 px-6">
        {!data || data.news.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-neutral-200 shadow-sm">
            <p className="text-neutral-500">아직 뉴스가 업데이트되지 않았습니다.</p>
          </div>
        ) : (
          <div className="grid gap-8">
            {(['kr', 'us'] as const).map((section) => {
              const items = data.news.filter((n) => n.section === section);
              if (items.length === 0) return null;
              const title = section === 'kr' ? '🇰🇷 한국 주요 경제 뉴스 (Top 5)' : '🇺🇸 미국 주요 경제 뉴스 (Top 5)';
              return (
                <section key={section}>
                  <h2 className="text-xl font-bold mb-6 text-neutral-800 border-b border-neutral-200 pb-2">
                    {title}
                  </h2>
                  <div className="grid gap-6">
                    {items.map((item, index) => (
                      <article key={`${section}-${index}`} className="bg-white p-8 rounded-2xl border border-neutral-200 shadow-sm hover:shadow-md transition-shadow">
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group"
                        >
                          <h3 className="text-lg font-bold mb-3 group-hover:text-blue-600 transition-colors leading-snug">
                            {item.title}
                          </h3>
                        </a>
                        <div className="space-y-2 mb-6 text-neutral-700 leading-relaxed whitespace-pre-line">
                          {item.summary}
                        </div>
                        {item.tickers && item.tickers.length > 0 && (
                          <div className="flex flex-wrap gap-2 items-center">
                            <TrendingUp className="w-4 h-4 text-emerald-500" />
                            <span className="text-neutral-500 text-sm font-medium">관련 기업:</span>
                            {item.tickers.map((ticker) => (
                              <span
                                key={ticker}
                                className="px-2 py-1 bg-neutral-100 text-neutral-600 text-xs font-semibold rounded-md border border-neutral-200"
                              >
                                {ticker}
                              </span>
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
            {data.news.some((n) => !n.section) && (
              <section>
                <h2 className="text-xl font-bold mb-6 text-neutral-800 border-b border-neutral-200 pb-2">뉴스</h2>
                <div className="grid gap-6">
                  {data.news.filter((n) => !n.section).map((item, index) => (
                    <article key={index} className="bg-white p-8 rounded-2xl border border-neutral-200 shadow-sm hover:shadow-md transition-shadow">
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className="group">
                        <h3 className="text-lg font-bold mb-3 group-hover:text-blue-600 transition-colors leading-snug">{item.title}</h3>
                      </a>
                      <div className="space-y-2 mb-6 text-neutral-700 leading-relaxed whitespace-pre-line">{item.summary}</div>
                      {item.tickers?.length > 0 && (
                        <div className="flex flex-wrap gap-2 items-center">
                          <TrendingUp className="w-4 h-4 text-emerald-500" />
                          <span className="text-neutral-500 text-sm font-medium">관련 기업:</span>
                          {item.tickers.map((t) => (
                            <span key={t} className="px-2 py-1 bg-neutral-100 text-neutral-600 text-xs font-semibold rounded-md border border-neutral-200">{t}</span>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <footer className="max-w-4xl mx-auto py-12 px-6 border-t border-neutral-200 text-center text-neutral-400 text-sm">
        <p>© {new Date().getFullYear()} Stock Morning Brief. Powered by Gemini AI & Redis.</p>
      </footer>
    </main>
  );
}
