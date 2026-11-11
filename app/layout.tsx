import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spendwise — AI Expense Agent",
  description: "Tell it what you spent in plain English. It logs, searches, budgets, charts and exports for you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
