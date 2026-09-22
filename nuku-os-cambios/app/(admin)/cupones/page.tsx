"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import { demoWorkspace } from "@/lib/mock-data";
import { useCurrentAccount } from "@/lib/account-context";
import { authHeader } from "@/lib/supabase/auth-header";

type PromoCode = {
  id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed_amount";
  discount_value: number;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  max_uses: number | null;
  uses_count: number;
  created_at: string;
};

const CLP = new Intl.NumberFormat("es-CL");

function formatDiscount(p: Pick<PromoCode, "discount_type" | "discount_value">) {
  return p.discount_type === "percent" ? `${p.discount_value}%` : `$${CLP.format(p.discount_value)}`;
}

const emptyForm = {
  code: "",
  description: "",
  discount_type: "percent" as "percent" | "fixed_amount",
  discount_value: "",
  valid_until: "",
  max_uses: "",
};

export default function CuponesPage() {
  const { accountId, accountName } = useCurrentAccount();
  const account = { ...demoWorkspace.account, name: accountName ?? demoWorkspace.account.name };

  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/dashboard/promo-codes", { headers: await authHeader() });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCodes(data.promoCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  useEffect(() => {
    if (!accountId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.code.trim()) {
      setFormError("Ponele un código (ej: VERANO2027).");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/dashboard/promo-codes", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          code: form.code,
          description: form.description || undefined,
          discount_type: form.discount_type,
          discount_value: Number(form.discount_value || 0),
          valid_until: form.valid_until || undefined,
          max_uses: form.max_uses ? Number(form.max_uses) : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo crear el código.");
    } finally {
      setCreating(false);
    }
  }

  async function toggle(p: PromoCode) {
    const nextActive = !p.active;
    setPendingId(p.id);
    setCodes((prev) => prev!.map((x) => (x.id === p.id ? { ...x, active: nextActive } : x)));
    try {
      const res = await fetch("/api/dashboard/promo-codes", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ id: p.id, active: nextActive }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
    } catch (err) {
      setCodes((prev) => prev!.map((x) => (x.id === p.id ? { ...x, active: p.active } : x)));
      setError(err instanceof Error ? err.message : "No se pudo guardar el cambio.");
    } finally {
      setPendingId(null);
    }
  }

  async function remove(p: PromoCode) {
    setPendingId(p.id);
    try {
      const res = await fetch(`/api/dashboard/promo-codes?id=${p.id}`, {
        method: "DELETE",
        headers: await authHeader(),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCodes((prev) => prev!.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el código.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <TopBar account={account} title="Cupones" />
      <main className="flex-1 space-y-6 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Creá acá los códigos promocionales de {account.name}. Cuando alguien
          escribe un código en el sitio del hostal, se valida en el momento
          contra esta lista — pero el descuento no se aplica solo: queda
          guardado en la reserva para que el equipo lo aplique a mano al
          cobrar (ver el botón &quot;Cobrar&quot; en Reservas).
        </p>

        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        <form
          onSubmit={handleCreate}
          className="max-w-2xl space-y-3 rounded-xl border border-line bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="col-span-2 text-xs text-ink-soft sm:col-span-1">
              Código
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="VERANO2027"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm uppercase text-ink outline-none focus:border-terracotta"
              />
            </label>
            <label className="text-xs text-ink-soft">
              Tipo
              <select
                value={form.discount_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, discount_type: e.target.value as "percent" | "fixed_amount" }))
                }
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-terracotta"
              >
                <option value="percent">% descuento</option>
                <option value="fixed_amount">Monto fijo (CLP)</option>
              </select>
            </label>
            <label className="text-xs text-ink-soft">
              Valor
              <input
                type="number"
                min={0}
                value={form.discount_value}
                onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                placeholder={form.discount_type === "percent" ? "10" : "15000"}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-terracotta"
              />
            </label>
            <label className="text-xs text-ink-soft">
              Válido hasta
              <input
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-terracotta"
              />
            </label>
            <label className="text-xs text-ink-soft">
              Máx. usos
              <input
                type="number"
                min={1}
                value={form.max_uses}
                onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
                placeholder="Sin límite"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-terracotta"
              />
            </label>
            <label className="col-span-2 text-xs text-ink-soft sm:col-span-3">
              Nota interna (no se muestra al huésped)
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Ej: código para seguidores de Instagram"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-terracotta"
              />
            </label>
          </div>

          {formError && <p className="text-xs text-rust">{formError}</p>}

          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-terracotta-bright disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? "Creando…" : "Crear código"}
          </button>
        </form>

        {!codes && !error && <p className="text-sm text-ink-faint">Cargando…</p>}

        {codes && codes.length === 0 && (
          <p className="max-w-2xl text-sm text-ink-faint">Todavía no creaste ningún código promocional.</p>
        )}

        {codes && codes.length > 0 && (
          <div className="max-w-2xl divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {codes.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 px-4 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="font-mono tracking-wide">{p.code}</span>
                    <span className="text-xs font-normal text-ink-faint">{formatDiscount(p)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-faint">
                    {p.description || "Sin nota"}
                    {p.valid_until ? ` · vence ${p.valid_until}` : ""}
                    {p.max_uses ? ` · ${p.uses_count}/${p.max_uses} usos` : ` · ${p.uses_count} usos`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`text-xs font-semibold tracking-wide ${p.active ? "text-sage" : "text-ink-faint"}`}
                  >
                    {p.active ? "Activo" : "Desactivado"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.active}
                    disabled={pendingId === p.id}
                    onClick={() => toggle(p)}
                    className={`inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent p-0 shadow-inner ring-1 ring-inset transition-colors duration-200 ease-in-out hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 ${
                      p.active ? "bg-sage ring-sage/40" : "bg-ink/20 ring-ink/15"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block h-5 w-5 shrink-0 rounded-full bg-white shadow transition-transform duration-200 ease-in-out ${
                        p.active ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    disabled={pendingId === p.id}
                    onClick={() => remove(p)}
                    className="text-xs font-medium text-ink-faint underline decoration-line underline-offset-2 transition-colors hover:text-rust disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Borrar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
