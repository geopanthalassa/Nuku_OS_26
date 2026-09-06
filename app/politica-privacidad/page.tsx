export default function PoliticaPrivacidadPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-paper px-6 py-16 text-ink">
      <h1 className="font-display text-3xl text-ink">Política de privacidad</h1>
      <p className="mt-2 text-sm text-ink-soft">Última actualización: septiembre de 2026</p>

      <section className="mt-8 space-y-4 text-sm leading-relaxed text-ink-soft">
        <p>
          Esta política de privacidad aplica a los alojamientos que usan Nuku OS como sistema de reservas y
          conserjería (incluyendo Kuhane Etno Hostal), tanto en el panel de administración como en el canal de
          WhatsApp conectado a cada cuenta.
        </p>

        <h2 className="font-display text-lg text-ink">Qué datos recopilamos</h2>
        <p>
          Cuando hacés una reserva o escribís por WhatsApp, guardamos los datos que nos das directamente: nombre,
          email, teléfono, fechas de estadía, cantidad de huéspedes, y el contenido de los mensajes que intercambiás
          con el alojamiento (incluyendo las respuestas generadas por nuestro asistente de conserjería con
          inteligencia artificial).
        </p>

        <h2 className="font-display text-lg text-ink">Para qué usamos esos datos</h2>
        <p>
          Usamos esta información únicamente para gestionar tu reserva, responder tus consultas, coordinar tu
          llegada y estadía, y — si el alojamiento lo tiene activado — enviarte recordatorios o mensajes de
          bienvenida relacionados con tu reserva. No vendemos ni compartimos tus datos con terceros para fines
          publicitarios.
        </p>

        <h2 className="font-display text-lg text-ink">Con quién compartimos datos</h2>
        <p>
          Para poder ofrecer el servicio, algunos datos pasan por proveedores que actúan en nuestro nombre: Meta
          (WhatsApp Business Platform) para enviar y recibir mensajes, Anthropic para generar las respuestas del
          asistente de conserjería, y Supabase para almacenar la base de datos de forma segura. Ninguno de estos
          proveedores usa tus datos para sus propios fines comerciales.
        </p>

        <h2 className="font-display text-lg text-ink">Cuánto tiempo guardamos los datos</h2>
        <p>
          Conservamos los datos de tu reserva y de la conversación mientras dure la relación con el alojamiento y
          por el tiempo razonable para fines administrativos y legales posteriores (por ejemplo, contabilidad).
          Podés pedir la eliminación de tus datos en cualquier momento escribiéndonos a la dirección de contacto de
          abajo.
        </p>

        <h2 className="font-display text-lg text-ink">Tus derechos</h2>
        <p>
          Podés pedirnos acceder, corregir o eliminar tus datos personales en cualquier momento. Para ejercer
          cualquiera de estos derechos, escribinos a{" "}
          <a className="underline" href="mailto:nuku.mkt@gmail.com">
            nuku.mkt@gmail.com
          </a>
          .
        </p>

        <h2 className="font-display text-lg text-ink">Contacto</h2>
        <p>
          Si tenés preguntas sobre esta política o sobre cómo tratamos tus datos, escribinos a{" "}
          <a className="underline" href="mailto:nuku.mkt@gmail.com">
            nuku.mkt@gmail.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}
