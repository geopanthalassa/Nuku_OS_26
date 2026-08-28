"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasSession } from "@/lib/admin-auth";

// Portón de entrada del panel — Fase 0 (ver lib/admin-auth.ts). Si no hay
// sesión guardada, manda a /login antes de mostrar nada del panel real.
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-paper">
        <p className="font-mono-ui text-xs uppercase tracking-widest text-ink-faint">Verificando acceso…</p>
      </div>
    );
  }

  return <>{children}</>;
}
