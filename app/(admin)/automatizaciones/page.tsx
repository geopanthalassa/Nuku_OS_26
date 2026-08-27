"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import { demoWorkspace } from "@/lib/mock-data";
import { CURRENT_ACCOUNT_ID } from "@/lib/current-account";

type Automation = {
  id: string;
  template_key: string;
  enabled: boolean;
  label: string;
  description: string;
};

export default function AutomatizacionesPage() {
  const { account } = demoWorkspace; // el nombre/branding del TopBar sigue viniendo de acá — es solo texto de UI
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/dashboard/automations?account_id=${CURRENT_ACCOUNT_ID}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAutomations(data.automations);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }, []);

  async function toggle(a: Automation) {
    const nextEnabled = !a.enabled;
    setPendingId(a.id);
    setAutomations((prev) => prev!.map((x) => (x.id === a.id ? { ...x, enabled: nextEnabled } : x)));

    try {
      const res = await fetch("/api/dashboard/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account_id: CURRENT_ACCOUNT_ID, id: a.id, enabled: nextEnabled }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
    } catch (err) {
      // revertir si falló al guardar
      setAutomations((prev) => prev!.map((x) => (x.id === a.id ? { ...x, enabled: a.enabled } : x)));
      setError(err instanceof Error ? err.message : "No se pudo guardar el cambio.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <TopBar account={account} title="Automatizaciones" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Reglas construidas en n8n, activables por cuenta sin tocar código.
          Estos interruptores ya son reales: quedan guardados en Supabase y
          n8n los respeta antes de mandar cada mensaje (ver
          n8n-templates/README.md).
        </p>

        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        {!automations && !error && (
          <p className="text-sm text-ink-faint">Cargando…</p>
        )}

        {automations && (
          <div className="max-w-2xl divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {automations.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-4 px-4 py-4">
                <div>
                  <div className="text-sm font-medium">{a.label}</div>
                  <div className="mt-0.5 text-xs text-ink-faint">{a.description}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={a.enabled}
                  disabled={pendingId === a.id}
                  onClick={() => toggle(a)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                    a.enabled ? "bg-sage" : "bg-surface-2"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform ${
                      a.enabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
