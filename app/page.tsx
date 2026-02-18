import { kv } from '@vercel/kv';
import { Newspaper, TrendingUp, Calendar } from 'lucide-react';

interface NewsItem {
  title: string;
  link: string;
  summary: string;
  tickers: string[];
}

interface DailyNews {
  updatedAt: string;
  news: NewsItem[];
}

export const dynamic = 'force-dynamic';

export default async function Home() {
  const data = await kv.get<DailyNews>('daily_news');

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
            {data.news.map((item, index) => (
              <article key={index} className="bg-white p-8 rounded-2xl border border-neutral-200 shadow-sm hover:shadow-md transition-shadow">
                <a 
                  href={item.link} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="group"
                >
                  <h2 className="text-xl font-bold mb-4 group-hover:text-blue-600 transition-colors leading-snug">
                    {item.title}
                  </h2>
                </a>
                <div className="space-y-2 mb-6 text-neutral-700 leading-relaxed whitespace-pre-line">
                  {item.summary}
                </div>
                {item.tickers && item.tickers.length > 0 && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                    {item.tickers.map((ticker) => (
                      <span 
                        key={ticker} 
                        className="px-2 py-1 bg-neutral-100 text-neutral-600 text-xs font-semibold rounded-md border border-neutral-200"
                      >
                        ${ticker}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <footer className="max-w-4xl mx-auto py-12 px-6 border-t border-neutral-200 text-center text-neutral-400 text-sm">
        <p>© {new Date().getFullYear()} Stock Morning Brief. Powered by Gemini AI & Vercel KV.</p>
      </footer>
    </main>
  );
}
