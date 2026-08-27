import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";

const SOURCE_LABEL: Record<string, string> = {
  direct: "Directo",
  booking: "Booking",
  instagram: "Instagram",
  airbnb: "Airbnb",
};

export default function HuespedesPage() {
  const { account, guests, reservations } = demoWorkspace;

  const stayCount = (guestId: string) =>
    reservations.filter((r) => r.guestId === guestId).length;

  return (
    <>
      <TopBar account={account} title="Huéspedes" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          CRM (Fase 3 del plan): una ficha por huésped en vez de repartida
          entre WhatsApp, Instagram y la memoria de quien atendió. Acá
          todavía es una lista simple — el historial detallado y las
          automatizaciones de reseña se agregan en la siguiente etapa.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {guests.map((g) => (
            <div key={g.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-terracotta font-mono-ui text-xs font-semibold text-paper">
                  {g.fullName
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div>
                  <div className="text-sm font-medium">{g.fullName}</div>
                  <Pill tone="neutral">{SOURCE_LABEL[g.source]}</Pill>
                </div>
              </div>
              <div className="mt-3 text-xs text-ink-faint">
                {stayCount(g.id)} {stayCount(g.id) === 1 ? "estadía" : "estadías"} registradas
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
