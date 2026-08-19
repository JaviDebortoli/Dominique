# Bugs

## Problemas ahora

- ~~No hay UI para crear categorías.~~ **Resuelto** (2026-08-18): `/admin/categorias` — alta, edición y borrado.
- Checkout sin ningún límite de abuso, no valida email/teléfono, no tiene CAPTCHA, y el rate-limiting de Nginx solo protege `/api/webhooks/mercadopago`, nada cubre `/api/checkout` ni `/admin/login`. Elegir `method: "PICKUP_CASH"` crea una orden `RESERVED` que sostiene el `held` hasta el cierre del próximo día hábil (potencialmente 1-3 días si cae viernes/feriado), sin pagar nada ni verificar identidad. Un script trivial puede spamear ese endpoint con datos inventados y dejar reservado todo el stock de la tienda durante días. Esto rompe exactamente la garantía que el diseño (D2/D3) se esfuerza tanto en sostener a nivel de base de datos; la vulnerabilidad no está en la atomicidad del stock, está en que nada impide generar reservas fantasma en volumen.
- Staff no puede cancelar un pedido manualmente. Las únicas transiciones a `CANCELLED` son automáticas. No existe una función tipo `cancelOrder()` ni una ruta admin para eso, y `/admin/pedidos` (`page.tsx`) solo muestra un botón de "marcar retirado", nada de cancelar. Si un cliente llama para desistir de una reserva `PICKUP_CASH`, el local no tiene forma de liberar ese stock antes de que venza solo.

## Problemas a corregir en el futuro

- Sin historial/reportes de ventas. `/admin/caja` solo muestra el estado actual (disponible/reservado/en depósito), no hay vista de "cuánto vendí hoy/esta semana" ni top productos.
- Un solo admin, sin gestión de usuarios.
- Sin rate-limit/lockout en `/admin/login`.
