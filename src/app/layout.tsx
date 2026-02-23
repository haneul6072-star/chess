import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chess With Friends",
  description: "Online 1v1 chess with remote play and pass-and-play",
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