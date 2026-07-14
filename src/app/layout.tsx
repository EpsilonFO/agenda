import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agenda IA",
  description: "Agenda personnel moderne piloté par un agent IA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link
          rel="preconnect"
          href="https://rsms.me/"
        />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
