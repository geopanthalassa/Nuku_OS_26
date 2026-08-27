import TopBar from "@/components/admin/TopBar";
import KpiCard from "@/components/ui/KpiCard";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { formatMoney, formatDateRange } from "@/lib/format";

export default function DashboardPage() {
  const { account, rooms, guests, reservations } = demoWorkspace;

  const upcoming = reservations
    .filter((r) => r.status === "confirmed")
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const occupied = new Set(
    reservations.filter((r) => r.status === "confirmed").map((r) => r.roomId)
  ).size;
  const occupancyPct = Math.round((occupied / rooms.length) * 100);

  const pendingPaymentCount = reservations.filter(
    (r) => r.paymentStatus === "pending"
  ).length;

  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "—";
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "—";

  return (
    <>
      <TopBar account={account} title="Resumen" />
      <main className="flex-1 space-y-8 p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Ocupación" value={`${occupancyPct}%`} hint={`${occupied} de ${rooms.length} habitaciones`} />
          <KpiCard label="Reservas activas" value={String(upcoming.length)} hint="confirmadas, sin cancelar" />
          <KpiCard label="Pagos pendientes" value={String(pendingPaymentCount)} hint="reservas por cobrar" />
        </div>

        <section>
          <h2 className="mb-3 font-display text-lg">Próximas llegadas</h2>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper-alt text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Huésped</th>
                  <th className="px-4 py-2.5 font-medium">Habitación</th>
                  <th className="px-4 py-2.5 font-medium">Fechas</th>
                  <th className="px-4 py-2.5 font-medium">Canal</th>
                  <th className="px-4 py-2.5 font-medium">Pago</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-medium">{guestName(r.guestId)}</td>
                    <td className="px-4 py-3 text-ink-soft">{roomName(r.roomId)}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateRange(r.checkIn, r.checkOut)}</td>
                    <td className="px-4 py-3">
                      <Pill tone="neutral">{r.channel}</Pill>
                    </td>
                    <td className="px-4 py-3">
                      {r.paymentStatus === "paid" ? (
                        <Pill tone="sage">Pagado · {formatMoney(r.totalCents, account.currency)}</Pill>
                      ) : (
                        <Pill tone="olive">Pendiente · {formatMoney(r.totalCents, account.currency)}</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
