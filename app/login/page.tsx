"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { checkCredentials, setSession } from "@/lib/admin-auth";

// Pantalla de ingreso — Fase 0 (ver lib/admin-auth.ts). Usuario y clave
// fijos por ahora; el objetivo acá es que el panel se vea a la altura
// del producto que es, no solo que funcione.
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Pausa cortita a propósito: sensación de "verificando", no de
    // formulario que solo compara strings en el cliente.
    setTimeout(() => {
      if (checkCredentials(username, password)) {
        setSession();
        router.push("/dashboard");
      } else {
        setError("Usuario o contraseña incorrectos.");
        setLoading(false);
      }
    }, 350);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#181a1f] px-6 py-12">
      {/* Fondo — degradés con la paleta de marca, nada de assets externos */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-[#a6512b] opacity-30 blur-[120px]" />
        <div className="absolute -bottom-40 -right-24 h-[36rem] w-[36rem] rounded-full bg-[#5c6b3f] opacity-30 blur-[130px]" />
        <div className="absolute left-1/2 top-1/3 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-[#6e6b35] opacity-20 blur-[110px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #f5f3ee 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Marca */}
        <div className="mb-9 flex flex-col items-center text-center">
          <div className="relative flex h-32 w-32 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-[#c97645] opacity-40 blur-2xl" />
            <Image
              src="/icon.png"
              alt="Nuku OS"
              width={128}
              height={128}
              priority
              className="relative rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-4 ring-[#f5f3ee]/15"
            />
          </div>
          <h1 className="font-display mt-6 text-4xl tracking-tight text-[#f5f3ee]">Nuku OS</h1>
          <p className="mt-2 text-[13px] uppercase tracking-[0.3em] text-[#c97645]">
            El sistema operativo de tu hostal
          </p>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-[#f5f3ee]/60">
            Reservas, huéspedes y automatizaciones — todo en un solo lugar,
            sin planillas ni WhatsApp perdido.
          </p>
        </div>

        {/* Tarjeta de ingreso */}
        <div className="rounded-2xl border border-white/10 bg-[#f5f3ee] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.45)] sm:p-8">
          <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Acceso al panel</p>
          <h2 className="font-display mt-1.5 text-xl text-ink">Bienvenido de vuelta</h2>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft" htmlFor="username">
                Usuario
              </label>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="kuhane_hostal"
                autoComplete="username"
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
                placeholder="••••••"
                autoComplete="current-password"
                className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-rust/30 bg-rust-soft px-3.5 py-2.5 text-xs text-rust">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Verificando…" : "Ingresar"}
            </button>
          </form>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-faint">
            Fase 0 — acceso de demostración para Kuhane. Usuario y clave
            provisorios mientras se conecta el login real.
          </p>
        </div>

        <p className="mt-8 text-center text-[11px] tracking-wide text-[#f5f3ee]/35">
          Nuku OS · Hospitalidad, ordenada.
        </p>
      </div>
    </main>
  );
}
