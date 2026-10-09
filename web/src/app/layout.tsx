import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const brand = Schibsted_Grotesk({
  variable: "--font-brand",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "¿Dónde me atienden?",
  description:
    "Habla con Gabriela y encuentra en qué sede de salud de tu municipio te pueden atender. También te explica tu documento.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1517" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${brand.variable} antialiased`}>{children}</body>
    </html>
  );
}
