export default function PagoExitosoPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sage-soft text-2xl text-sage">✓</div>
      <h1 className="font-display text-2xl text-ink">¡Pago recibido!</h1>
      <p className="max-w-sm text-sm text-ink-soft">
        Gracias — tu pago quedó confirmado. El equipo de Kuhane ya tiene el aviso y te va a escribir para los
        últimos detalles de tu llegada.
      </p>
    </main>
  );
}
