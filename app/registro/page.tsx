"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

// Registro self-serve — Fase 1. Cualquier alojamiento nuevo crea su
// cuenta acá mismo, sin que nadie de Nuku OS tenga que cargarla a mano:
// esta pantalla llama a /api/auth/signup (crea el usuario, la cuenta y el
// vínculo entre ambos) y después abre sesión directo.
export default function RegistroPage() {
  const router = useRouter();
  const [hostalName, setHostalName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostal_name: hostalName, owner_name: ownerName, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear la cuenta.");

      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(signInError.message);

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la cuenta.");
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#181a1f] px-6 py-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-[#a6512b] opacity-30 blur-[120px]" />
        <div className="absolute -bottom-40 -right-24 h-[36rem] w-[36rem] rounded-full bg-[#5c6b3f] opacity-30 blur-[130px]" />
        <div className="absolute left-1/2 top-1/3 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-[#6e6b35] opacity-20 blur-[110px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, #f5f3ee 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-9 flex flex-col items-center text-center">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-[#c97645] opacity-40 blur-2xl" />
            <Image
              src="/icon.png"
              alt="Nuku OS"
              width={96}
              height={96}
              priority
              className="relative rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-4 ring-[#f5f3ee]/15"
            />
          </div>
          <h1 className="font-display mt-6 text-3xl tracking-tight text-[#f5f3ee]">Crea tu cuenta</h1>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-[#f5f3ee]/60">
            Reservas, huéspedes y automatizaciones — todo en un solo lugar. Tu panel queda listo apenas confirmas.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#f5f3ee] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.45)] sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft" htmlFor="hostalName">
                Nombre de tu alojamiento
              </label>
              <input
                id="hostalName"
                value={hostalName}
                onChange={(e) => setHostalName(e.target.value)}
                placeholder="Ej: Kuhane Etno-Hostal"
                required
                className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft" htmlFor="ownerName">
                Tu nombre
              </label>
              <input
                id="ownerName"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                autoComplete="email"
                required
                className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-rust/30 bg-rust-soft px-3.5 py-2.5 text-xs text-rust">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !hostalName || !email || !password}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Creando cuenta…" : "Crear cuenta"}
            </button>
          </form>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-faint">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-medium text-terracotta underline underline-offset-2">
              Inicia sesión
            </Link>
          </p>
        </div>

        <p className="mt-8 text-center text-[11px] tracking-wide text-[#f5f3ee]/35">
          Nuku OS · Hospitalidad, ordenada.
        </p>
      </div>
    </main>
  );
}
