# Kuhane Etno-Hostal — sitio web

Next.js (App Router) + TypeScript + Tailwind CSS v4. Fase 1: Home pública
completa, con placeholders donde todavía falta información real.

## Cómo correrlo

```bash
npm install
npm run dev
```

Abrí http://localhost:3000

## Qué falta cargar (todo marcado como [POR CONFIRMAR] o TODO en el código)

- **Video del hero** → `public/media/hero-kuhane.mp4` (y una imagen de
  respaldo en `public/images/hero-fallback.jpg`). El componente `Hero`
  detecta solo si el archivo existe y lo usa automáticamente.
- **Fotografías reales** → van en `public/images/`. Cada sección usa un
  componente `PlaceholderMedia` como marcador visual; se reemplaza por
  `<Image>` de `next/image` a medida que lleguen las fotos.
- **Contenido de texto y datos** → todo vive en `lib/site-content.ts`
  (un solo archivo). Ahí están: habitaciones, libros, voces de Rapa Nui,
  reseñas, WhatsApp, email, distancia a Ahu Tahai, rating de Google/
  TripAdvisor/Booking (confirmar cuál es la fuente real), etc.
- **Fuentes de marca (Fraunces + Inter)** → este entorno de desarrollo no
  tiene salida a internet hacia Google Fonts, así que por ahora el sitio
  usa fuentes del sistema. Ni bien lo abras en tu máquina o lo despliegues
  en Vercel (ambos con internet normal), seguí las instrucciones que están
  comentadas arriba de `app/layout.tsx` para activar `next/font/google` —
  son 3 líneas para descomentar.
- **Logo**: ya está integrado (`public/logo/`), extraído de la imagen que
  mandaste y con el fondo removido. Si en algún momento tenés el archivo
  vectorial original (SVG/AI), es mejor reemplazarlo por ese.

## Estructura

```
app/                 rutas y layout (App Router)
components/layout/    Nav, Footer
components/sections/  las secciones de la Home (Hero, RapaNui, Kuhane, ...)
components/ui/        piezas reutilizables (PlaceholderMedia, Reveal, SectionIntro)
lib/site-content.ts    todo el contenido/copy del sitio en un solo lugar
public/logo/           logo procesado (fondo transparente)
public/media/          acá va el video del hero
public/images/         acá van las fotos reales
```

## Fases siguientes (todavía NO implementadas, a propósito)

Reservas, Concierge, CRM y automatizaciones quedan para fases
independientes, como se definió en el brief. Cuando lleguen, estas rutas
son las que se agregarían (no existen todavía):

```
/admin
/dashboard
/inbox
/guests
/reservations
/ugc
/content
```

Junto con integraciones futuras: Supabase (datos + storage de fotos UGC),
WhatsApp, Instagram, n8n, motor de reservas y pagos.

## Deploy

Pensado para Vercel: conectar el repo y desplegar sin configuración
adicional (Next.js + Tailwind ya están listos para eso).
