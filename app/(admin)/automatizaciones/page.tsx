"use client";

import { useState } from "react";
import TopBar from "@/components/admin/TopBar";
import { demoWorkspace } from "@/lib/mock-data";

export default function AutomatizacionesPage() {
  const { account, automations: initial } = demoWorkspace;
  const [automations, setAutomations] = useState(initial);

  const toggle = (id: string) =>
    setAutomations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    );

  return (
    <>
      <TopBar account={account} title="Automatizaciones" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Reglas construidas en n8n (Fase 3 del plan), activables por cuenta
          sin tocar código. Los interruptores acá son de demostración — la
          conexión real a n8n llega junto con el Concierge y el CRM.
        </p>
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
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
                onClick={() => toggle(a.id)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
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
      </main>
    </>
  );
}
