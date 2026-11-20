// 모든 페이지에 공통으로 씌워지는 틀

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "법률창고",
  description: "사실관계로 관련 법령, 조세심판원 선결정례, 법원 판결을 찾습니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
