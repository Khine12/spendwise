import type { Metadata } from "next";
import { Cormorant_Garamond, Jost, Pinyon_Script } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-cormorant", display: "swap" });
const jost = Jost({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-jost", display: "swap" });
const pinyon = Pinyon_Script({ subsets: ["latin"], weight: "400", variable: "--font-pinyon", display: "swap" });

export const metadata: Metadata = {
  title: "Spendwise — AI Expense Agent",
  description: "Tell it what you spent in plain English. It logs, searches, budgets, charts and exports for you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. translators) add attributes to <html> before React loads
    <html lang="en" className={`${cormorant.variable} ${jost.variable} ${pinyon.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
