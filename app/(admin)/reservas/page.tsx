import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { formatMoney, formatDateRange, nights } from "@/lib/format";

const STATUS_TONE = {
  confirmed: "sage",
  completed: "neutral",
  cancelled: "rust",
} as const;

export default function ReservasPage() {
  const { account, rooms, guests, reservations } = demoWorkspace;
  const guestName = (id: string) => guests.find((g) => g.id === id)?.fullName ?? "—";
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "—";

  return (
    <>
      <TopBar account={account} title="Reservas" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Motor de Reservas genérico (Fase 1 del plan): esta lista es lo que
          hoy vive en WhatsApp, planillas y Booking, unificado en un solo
          lugar. El calendario de disponibilidad y el checkout en línea son
          el siguiente paso — acá se ve la forma que tendrán los datos.
        </p>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper-alt text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Huésped</th>
                <th className="px-4 py-2.5 font-medium">Habitación</th>
                <th className="px-4 py-2.5 font-medium">Fechas</th>
                <th className="px-4 py-2.5 font-medium">Noches</th>
                <th className="px-4 py-2.5 font-medium">Canal</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{guestName(r.guestId)}</td>
                  <td className="px-4 py-3 text-ink-soft">{roomName(r.roomId)}</td>
                  <td className="px-4 py-3 text-ink-soft">{formatDateRange(r.checkIn, r.checkOut)}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-soft">{nights(r.checkIn, r.checkOut)}</td>
                  <td className="px-4 py-3">
                    <Pill tone="neutral">{r.channel}</Pill>
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(r.totalCents, account.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
