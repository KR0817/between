import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Between · 两个人的会话",
  description: "创建双人房间，通过邀请链接聊天和传文件。",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
