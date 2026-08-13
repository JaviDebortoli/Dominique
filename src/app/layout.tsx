import type { Metadata } from "next";
import { Bodoni_Moda, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Brand typography (ejemplo/DESIGN.md): Bodoni Moda for headlines/editorial,
// Hanken Grotesk for all functional/body text.
const bodoniModa = Bodoni_Moda({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "variable",
});

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: "Dominique",
  description: "Moda con talles reales — retiro exclusivo en local físico.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-AR"
      className={`${bodoniModa.variable} ${hankenGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
