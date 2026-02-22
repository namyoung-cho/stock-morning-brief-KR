import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// 👇 바로 이 부분이 탭 제목을 바꿔줍니다!
export const metadata: Metadata = {
  title: "Morning News Brief",
  description: "매일 아침 배달되는 AI가 분석하는 경제 뉴스 브리핑",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={inter.className}>{children}</body>
    </html>
  );
}