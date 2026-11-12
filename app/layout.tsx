import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phigrad — Communication workspace",
  description: "A unified workspace for customer conversations and connected accounts.",
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
