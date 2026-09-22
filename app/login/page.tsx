"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import PasswordInput from "@/components/ui/PasswordInput";

// Pantalla de ingreso — Fase 1: login real contra Supabase Auth (antes
// era usuario/clave fijos comparados en el cliente, ver lib/admin-auth.ts
// para el porqué histórico).
//
// Desde el 22/9/2026 esta pantalla también maneja la recuperación de
// contraseña, porque antes no existía ninguna página que lo hiciera: el
// link que manda Supabase por mail (desde el botón "Send password
// recovery" del Dashboard, o desde "¿Olvidaste tu contraseña?" acá abajo)
// cae en esta misma URL con un token en el hash. supabase-js lo detecta
// solo (detectSessionInUrl, activado por default) y dispara el evento
// "PASSWORD_RECOVERY" — ahí cambiamos a modo "recovery" y mostramos el
// formulario para elegir la contraseña nueva.
//
// Para que el link del mail caiga acá y no en localhost, la Site URL del
// proyecto en Supabase (Authentication → URL Configuration) tiene que
// apuntar a la URL real de producción — ver la nota que le mandé a Andre.
type Mode = "login" | "forgot" | "recovery";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");

  // Login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Olvidé mi contraseña
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  // Elegir contraseña nueva (después de abrir el link del mail)
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("recovery");
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError("Email o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotLoading(true);

    const supabase = getSupabaseBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/login`,
    });

    setForgotLoading(false);
    if (resetError) {
      setForgotError(resetError.message);
      return;
    }
    setForgotSent(true);
  }

  async function handleRecoverySubmit(e: FormEvent) {
    e.preventDefault();
    setRecoveryError(null);

    if (newPassword.length < 8) {
      setRecoveryError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setRecoveryError("Las dos contraseñas no coinciden.");
      return;
    }

    setRecoveryLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setRecoveryLoading(false);

    if (updateError) {
      setRecoveryError(updateError.message);
      return;
    }
    router.push("/dashboard");
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
            backgroundImage: "radial-gradient(circle at 1px 1px, #f5f3ee 1px, transparent 0)",
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

        {/* Tarjeta */}
        <div className="rounded-2xl border border-white/10 bg-[#f5f3ee] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.45)] sm:p-8">
          {mode === "login" && (
            <>
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Acceso al panel</p>
              <h2 className="font-display mt-1.5 text-xl text-ink">Bienvenido de vuelta</h2>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={setPassword}
                    placeholder="••••••"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
                  />
                </div>

                {error && (
                  <p className="rounded-lg border border-rust/30 bg-rust-soft px-3.5 py-2.5 text-xs text-rust">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Verificando…" : "Ingresar"}
                </button>
              </form>

              <p className="mt-4 text-center text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(email);
                    setForgotSent(false);
                    setForgotError(null);
                    setMode("forgot");
                  }}
                  className="font-medium text-terracotta underline underline-offset-2"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </p>

              <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-faint">
                ¿No tienes cuenta?{" "}
                <Link href="/registro" className="font-medium text-terracotta underline underline-offset-2">
                  Crea la tuya
                </Link>
              </p>
            </>
          )}

          {mode === "forgot" && (
            <>
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Recuperar acceso</p>
              <h2 className="font-display mt-1.5 text-xl text-ink">¿Olvidaste tu contraseña?</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                Escribe tu email y te mandamos un link para elegir una contraseña nueva.
              </p>

              {forgotSent ? (
                <p className="mt-5 rounded-lg border border-sage/30 bg-sage-soft px-3.5 py-3 text-sm text-sage">
                  Listo — revisa tu correo (y la carpeta de spam). El link vale por poco tiempo, ábrelo apenas te
                  llegue.
                </p>
              ) : (
                <form onSubmit={handleForgotSubmit} className="mt-6 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ink-soft" htmlFor="forgot-email">
                      Email
                    </label>
                    <input
                      id="forgot-email"
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      autoComplete="email"
                      required
                      className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
                    />
                  </div>

                  {forgotError && (
                    <p className="rounded-lg border border-rust/30 bg-rust-soft px-3.5 py-2.5 text-xs text-rust">
                      {forgotError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={forgotLoading || !forgotEmail}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {forgotLoading ? "Enviando…" : "Enviar link"}
                  </button>
                </form>
              )}

              <p className="mt-5 text-center text-[11px]">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="font-medium text-terracotta underline underline-offset-2"
                >
                  Volver a ingresar
                </button>
              </p>
            </>
          )}

          {mode === "recovery" && (
            <>
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Recuperar acceso</p>
              <h2 className="font-display mt-1.5 text-xl text-ink">Elige tu contraseña nueva</h2>

              <form onSubmit={handleRecoverySubmit} className="mt-6 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-soft" htmlFor="new-password">
                    Contraseña nueva
                  </label>
                  <PasswordInput
                    id="new-password"
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-soft" htmlFor="confirm-password">
                    Repite la contraseña
                  </label>
                  <PasswordInput
                    id="confirm-password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-terracotta"
                  />
                </div>

                {recoveryError && (
                  <p className="rounded-lg border border-rust/30 bg-rust-soft px-3.5 py-2.5 text-xs text-rust">
                    {recoveryError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={recoveryLoading || !newPassword || !confirmPassword}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {recoveryLoading ? "Guardando…" : "Guardar contraseña"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-[11px] tracking-wide text-[#f5f3ee]/35">
          Nuku OS · Hospitalidad, ordenada.
        </p>
      </div>
    </main>
  );
}
