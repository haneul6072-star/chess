import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chess With Friends",
  description: "친구와 온라인으로 1대1 체스를 두고, 같은 컴퓨터에서도 번갈아 플레이할 수 있어요.",
  openGraph: {
    title: "Chess With Friends",
    description: "친구와 온라인 1대1 체스. 방 코드로 바로 입장해서 플레이.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Chess With Friends",
    description: "친구와 온라인 1대1 체스. 방 코드로 바로 입장해서 플레이.",
  },
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}