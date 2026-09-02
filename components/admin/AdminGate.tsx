"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { AccountContext, type CurrentAccount } from "@/lib/account-context";

type Status = "checking" | "ready" | "no-account";

const EMPTY_ACCOUNT: CurrentAccount = { accountId: null, accountName: null, role: null, email: null };

// Portón de entrada del panel — Fase 1. Ya no es un password fijo
// comparado en el cliente (ver lib/admin-auth.ts para el porqué
// histórico): ahora valida la sesión real de Supabase Auth y resuelve a
// qué cuenta pertenece ese usuario a través de /api/auth/me. Todo lo que
// esté dentro del panel recibe esa cuenta vía useCurrentAccount().
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [account, setAccount] = useState<CurrentAccount>(EMPTY_ACCOUNT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    async function resolve() {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        router.replace("/login");
        return;
      }

      try {
        const res = await fetch("/api/auth/me", {
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setErrorMessage(data.error ?? "No se pudo verificar tu cuenta.");
          setStatus("no-account");
          return;
        }

        setAccount({
          accountId: data.account_id,
          accountName: data.account_name,
          role: data.role,
          email: data.email,
        });
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setErrorMessage("No se pudo conectar con el servidor. Intenta de nuevo en un momento.");
          setStatus("no-account");
        }
      }
    }

    resolve();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) router.replace("/login");
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-paper">
        <p className="font-mono-ui text-xs uppercase tracking-widest text-ink-faint">Verificando acceso…</p>
      </div>
    );
  }

  if (status === "no-account") {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
        <p className="font-display text-xl text-ink">No pudimos abrir tu panel</p>
        <p className="max-w-sm text-sm text-ink-soft">{errorMessage}</p>
        <button
          type="button"
          onClick={async () => {
            await getSupabaseBrowserClient().auth.signOut();
            router.replace("/login");
          }}
          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Volver a iniciar sesión
        </button>
      </div>
    );
  }

  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}
