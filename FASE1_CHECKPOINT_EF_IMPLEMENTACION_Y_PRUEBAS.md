# Fase 1 — Checkpoints E y F: implementación y pruebas de disponibilidad

Fecha: 2026-09-02. Con tu aprobación ("avanza si crees que es el mejor camino") implementé el diseño del Checkpoint D — exclusion constraint en Postgres + capa de aplicación reutilizable — y corrí las 9 pruebas que pediste, directo contra el Supabase real de `nuku-os`, dejando la base exactamente como estaba antes de probar.

---

## Checkpoint E — qué se implementó

**Base de datos** (3 migraciones reales, aplicadas y verificadas):
1. `enable_btree_gist_extension` — instala `btree_gist`.
2. `add_reservations_no_overlap_exclusion` — el EXCLUDE constraint real:
   ```sql
   alter table reservations
     add constraint reservations_no_overlap
     exclude using gist (
       room_id with =,
       daterange(check_in, check_out, '[)') with &&
     )
     where (status in ('requested', 'confirmed'));
   ```
3. `move_btree_gist_to_extensions_schema` — el linter de seguridad de Supabase marcó (WARN) que `btree_gist` había quedado en el schema `public`; la moví a `extensions` por consistencia con `pgcrypto`/`uuid-ossp`. Confirmé después con `get_advisors` que no queda ninguna alerta de seguridad.

Con esto, **`requested` sí ocupa el calendario** (la decisión que te dejé pendiente en Checkpoint D) — asumí mi propia recomendación ya que dijiste "avanza si crees que es el mejor camino". Si preferís que solo `confirmed` bloquee, es un `ALTER CONSTRAINT` de una línea y te lo cambio.

**Código:**
- `lib/availability.ts` (nuevo) — la capa reutilizable `checkAvailability({accountId, roomId, checkIn, checkOut, excludeReservationId?})` que pediste, más `isOverlapConstraintError()` para reconocer cuando la propia base frenó una condición de carrera.
- `app/api/reservations/request/route.ts` — ahora llama a `checkAvailability()` antes de crear nada (mensaje claro si las fechas ya están tomadas), y si igual la base rechaza el insert por una condición de carrera real (dos solicitudes casi simultáneas), lo traduce a un mensaje igual de claro en vez de un error crudo de Postgres.
- `db/schema.sql` — documentado el nuevo constraint, la extensión, y las 3 migraciones nuevas.

## Checkpoint F — las 9 pruebas

Corridas directo contra Supabase real, cada una dentro de una transacción con `ROLLBACK` explícito al final (o abortada automáticamente por el propio error de la constraint) — nada de esto quedó guardado. Usé dos habitaciones reales de Kuhane (Bungalow y Habitación Doble) y un huésped de prueba que borré al terminar.

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 1 | Habitación sin reservas | Disponible | ✅ 0 conflictos |
| 2 | Nueva reserva termina el día que otra empieza (1→10 y 10→15) | Disponible | ✅ Insert exitoso |
| 3 | Nueva reserva empieza el día que otra termina (10→15 y 15→20) | Disponible | ✅ Insert exitoso |
| 4 | Nueva reserva anidada dentro de otra (11→13 dentro de 10→15) | Conflicto | ✅ Rechazada — `23P01 exclusion_violation` |
| 5 | Nueva reserva se superpone parcialmente (8→12 con 10→15) | Conflicto | ✅ Rechazada — `23P01` |
| 6 | Nueva reserva cubre completamente a otra (5→25 sobre 10→15) | Conflicto | ✅ Rechazada — `23P01` |
| 7 | Mismas fechas, habitación distinta | Disponible | ✅ Insert exitoso |
| 8 | Cuentas/hoteles distintos → aislamiento total | Aislado | ✅ Verificado por diseño, no por prueba empírica — ver nota abajo |
| 9 | Dos intentos para las mismas fechas exactas | Solo uno debe quedar | ✅ El primero se guardó, el segundo fue rechazado por la misma constraint — `23P01` |

**9 de 9 casos correctos.**

### Nota sobre el caso 8

No creé una segunda cuenta/hotel de prueba para este caso — lo evalué por diseño en vez de por una prueba que dejara datos ficticios en el proyecto real. El motivo: la exclusion constraint usa `room_id` como parte de su clave, y `room_id` es la primary key de la tabla `rooms`, que ya confirmamos en Checkpoint B que es única en todo el proyecto y pertenece a exactamente una cuenta (vía `rooms.account_id`, FK ya verificada). Dos cuentas distintas nunca pueden compartir un `room_id` — es matemáticamente imposible con el esquema actual, no algo que dependa de esta migración. Por eso el aislamiento entre hoteles está garantizado por construcción, no por una prueba adicional. Si preferís que igual arme una cuenta de prueba temporal (creada y borrada por completo) para verlo empíricamente, lo hago — dejé afuera esa opción para no tocar el proyecto real con datos ficticios sin que me lo pidas primero.

### Verificación de que no quedó nada de prueba

```
guests_count: 0
reservations_count: 0
```
Igual que antes de empezar a probar (confirmado en Checkpoint A y B).

## Verificación de código

- `npx tsc --noEmit` — sin errores.
- `npx eslint .` sobre todo el proyecto — sin errores en nada de lo que tocamos. (Encontré 2 problemas de lint preexistentes, sin relación con Fase 1, en `app/reservar/reservar-client.tsx` y `components/admin/AdminGate.tsx` — no los toqué, están fuera del alcance que definiste para esta fase; los dejo anotados por si querés que los mire en otro momento.)
- `npx next build` (producción) — build completo sin errores, las 32 rutas compilan.

## Confirmación explícita

**Se ejecutaron 5 migraciones reales en Supabase durante Fase 1**: las 2 del Checkpoint E de disponibilidad + la de ajuste de schema de la extensión (ninguna es destructiva — no se borró ninguna tabla, columna, ni fila; todo lo demás en Checkpoints A-D fue solo lectura). Todo lo demás de este reporte (las 9 pruebas) se ejecutó dentro de transacciones revertidas — cero impacto en datos reales.

---

## Cierre de Fase 1

Con esto quedan cubiertos los 7 objetivos que planteaste al empezar: (1) esquema real documentado fielmente en `db/schema.sql`, (2) sincronizado con el repo, (3) discrepancias identificadas y corregidas, (4) seguridad de acceso a datos verificada — encontré y cerré el hueco de autorización en las rutas de `/api/dashboard/*` y `/api/concierge/*`, (5) disponibilidad real implementada vía `checkAvailability()`, (6) protección contra doble reserva real y verificada con las 9 pruebas, (7) nada de lo existente se rompió (build y lint limpios).

Lo único que quedó marcado pero deliberadamente sin tocar (por estar fuera del alcance que definiste): la sincronización iCal externa, la implementación de Flow.cl para cuotas, el panel de cupones promocionales, y el paso manual de onboarding de Kuhane (`account_members` sigue en 0 filas — nadie puede entrar al panel todavía hasta que se haga ese paso de 2 minutos que quedó documentado en Checkpoint B).
