import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phigrad CRM — Business relationships, clearly organized",
  description: "A local-first CRM for business relationships, opportunities, follow-ups, and conversations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
