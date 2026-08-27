import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  email: "Correo",
};

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "hace unos minutos";
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

export default function BandejaPage() {
  const { account, guests, conversations } = demoWorkspace;
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "—";

  return (
    <>
      <TopBar account={account} title="Bandeja" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Bandeja unificada (Fase 2 del plan): WhatsApp, Instagram y correo
          en un solo lugar. Cada cuenta conecta sus propias credenciales de
          WhatsApp Business API e Instagram — acá se ve la estructura antes
          de esa conexión real.
        </p>
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {conversations.map((c) => {
            const last = c.messages[c.messages.length - 1];
            return (
              <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <Pill tone="neutral">{CHANNEL_LABEL[c.channel]}</Pill>
                  <div>
                    <div className="text-sm font-medium">{guestName(c.guestId)}</div>
                    <div className="text-xs text-ink-faint">{last?.body}</div>
                  </div>
                </div>
                <div className="shrink-0 text-xs text-ink-faint">{timeAgo(c.lastMessageAt)}</div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
