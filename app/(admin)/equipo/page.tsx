"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import PasswordInput from "@/components/ui/PasswordInput";
import { demoWorkspace } from "@/lib/mock-data";
import { useCurrentAccount } from "@/lib/account-context";
import { authHeader } from "@/lib/supabase/auth-header";

type Member = {
  user_id: string;
  role: string;
  created_at: string;
  email: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  staff: "Staff",
};

const emptyForm = { email: "", password: "", role: "staff" as "owner" | "staff" };

export default function EquipoPage() {
  const { accountId, accountName, email: myEmail, role: myRole } = useCurrentAccount();
  const account = { ...demoWorkspace.account, name: accountName ?? demoWorkspace.account.name };

  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  async function load() {
    if (!accountId) return;
    try {
      const res = await fetch("/api/dashboard/team", { headers: await authHeader() });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMembers(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  useEffect(() => {
    if (!accountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.email.trim()) {
      setFormError("Falta el email.");
      return;
    }
    if (form.password.length < 8) {
      setFormError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/dashboard/team", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ email: form.email.trim(), password: form.password, role: form.role }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo agregar el acceso.");
    } finally {
      setCreating(false);
    }
  }

  async function remove(m: Member) {
    setPendingUserId(m.user_id);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/team?user_id=${m.user_id}`, {
        method: "DELETE",
        headers: await authHeader(),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMembers((prev) => (prev ? prev.filter((x) => x.user_id !== m.user_id) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar el acceso.");
    } finally {
      setPendingUserId(null);
    }
  }

  const isOwner = myRole === "owner";

  return (
    <>
      <TopBar account={account} title="Equipo" />
      <main className="flex-1 space-y-6 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Cada persona de acá tiene su propio email y contraseña para entrar,
          pero todas ven exactamente los mismos datos de {account.name} — no
          son cuentas separadas, es el mismo panel con más de un login.
        </p>

        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        {isOwner && (
          <form onSubmit={handleCreate} className="max-w-2xl space-y-3 rounded-xl border border-line bg-surface p-4">
            <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
              Agregar un acceso nuevo
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-xs text-ink-soft">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="kuhanehostal@gmail.com"
                  className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>
              <label className="text-xs text-ink-soft">
                Contraseña
                <div className="mt-1">
                  <PasswordInput
                    id="team-password"
                    value={form.password}
                    onChange={(value) => setForm((f) => ({ ...f, password: value }))}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-terracotta"
                  />
                </div>
              </label>
              <label className="text-xs text-ink-soft">
                Rol
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "owner" | "staff" }))}
                  className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-terracotta"
                >
                  <option value="staff">Staff</option>
                  <option value="owner">Owner</option>
                </select>
              </label>
            </div>
            {formError && <p className="text-xs text-rust">{formError}</p>}
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-terracotta-bright disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "Creando…" : "Crear acceso"}
            </button>
          </form>
        )}

        {!isOwner && members && (
          <p className="max-w-2xl text-sm text-ink-faint">Solo un owner de la cuenta puede agregar o quitar accesos.</p>
        )}

        {!members && !error && <p className="text-sm text-ink-faint">Cargando…</p>}

        {members && members.length > 0 && (
          <div className="max-w-2xl divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-4 px-4 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{m.email ?? "(sin email)"}</span>
                    <Pill tone={m.role === "owner" ? "sage" : "neutral"}>{ROLE_LABEL[m.role] ?? m.role}</Pill>
                    {m.email === myEmail && <span className="text-[11px] font-normal text-ink-faint">(tú)</span>}
                  </div>
                </div>
                {isOwner && m.email !== myEmail && (
                  <button
                    type="button"
                    disabled={pendingUserId === m.user_id}
                    onClick={() => remove(m)}
                    className="shrink-0 text-xs font-medium text-ink-faint underline decoration-line underline-offset-2 transition-colors hover:text-rust disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Quitar acceso
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
