import Pill from "@/components/ui/Pill";
import type { Account } from "@/lib/types";

export default function TopBar({ account, title }: { account: Account; title: string }) {
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-4">
      <h1 className="font-display text-xl">{title}</h1>
      <div className="flex items-center gap-3">
        <Pill tone="olive">Modo demo</Pill>
        <button
          type="button"
          disabled
          title="Conectar más cuentas llega en una fase posterior"
          className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink-soft opacity-70"
        >
          <span className="h-2 w-2 rounded-full bg-sage" />
          {account.name}
          <span className="text-ink-faint">▾</span>
        </button>
      </div>
    </header>
  );
}
