import type { Metadata } from "next";
import "./globals.css";

// NOTA: igual que en kuhane-web, este entorno de desarrollo no tiene salida
// a internet hacia fonts.googleapis.com. Por ahora la tipografía usa fuentes
// del sistema (ver app/globals.css). Para activar las fuentes de marca en tu
// máquina o en Vercel:
//   1) descomentar el import de next/font/google acá abajo
//   2) pasar newsreader.variable / plexSans.variable / plexMono.variable al <html>
// TODO: activar next/font/google (Newsreader + IBM Plex Sans + IBM Plex Mono).
// import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

export const metadata: Metadata = {
  title: {
    default: "Nuku OS — Panel",
    template: "%s — Nuku OS",
  },
  description:
    "Sistema operativo para hostales boutique: reservas, concierge, CRM y automatizaciones en un solo lugar.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
