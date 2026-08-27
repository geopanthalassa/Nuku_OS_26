import Image from "next/image";
import Link from "next/link";

// Placeholder de login. La autenticación real (Supabase Auth) se conecta
// junto con la Fase 0 técnica cuando exista un proyecto Supabase — por
// ahora este botón entra directo al panel con la cuenta de ejemplo.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 bg-paper-alt px-6 text-center">
      <Image src="/logo/nuku-mark.png" alt="Nuku OS" width={56} height={56} className="rounded-full" />
      <div className="flex items-center gap-2 font-mono-ui text-sm uppercase tracking-widest text-ink-faint">
        Nuku OS
      </div>
      <h1 className="font-display text-3xl">Panel de operación</h1>
      <p className="max-w-md text-sm text-ink-soft">
        Fase 0 — todavía sin autenticación real conectada. Este acceso entra
        directo con la cuenta de Kuhane, con habitaciones, huéspedes y
        reservas de ejemplo (los datos reales todavía no existen).
      </p>
      <Link
        href="/dashboard"
        className="rounded-lg bg-terracotta px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
      >
        Entrar como Kuhane Etno-Hostal
      </Link>
    </main>
  );
}
