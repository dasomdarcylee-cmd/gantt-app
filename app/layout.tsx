import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "일정 관리 간트 차트",
  description: "담당자, 세부 일정, 메모, 도형과 색상을 관리하는 간트 차트"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
