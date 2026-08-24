# Bugs

## Problemas ahora

- ~~No hay UI para crear categorías.~~ **Resuelto** (2026-08-18): `/admin/categorias` — alta, edición y borrado.
- ~~Checkout sin ningún límite de abuso, no valida email/teléfono, no tiene CAPTCHA, y el rate-limiting de Nginx solo protege `/api/webhooks/mercadopago`, nada cubre `/api/checkout` ni `/admin/login`. Elegir `method: "PICKUP_CASH"` crea una orden `RESERVED` que sostiene el `held` hasta el cierre del próximo día hábil (potencialmente 1-3 días si cae viernes/feriado), sin pagar nada ni verificar identidad. Un script trivial puede spamear ese endpoint con datos inventados y dejar reservado todo el stock de la tienda durante días. Esto rompe exactamente la garantía que el diseño (D2/D3) se esfuerza tanto en sostener a nivel de base de datos; la vulnerabilidad no está en la atomicidad del stock, está en que nada impide generar reservas fantasma en volumen.~~ **Resuelto** (2026-08-22): validación de formato email/teléfono, tope de 3 reservas `PICKUP_CASH` sin confirmar por identidad (email + teléfono), y rate-limiting de Nginx en `/api/checkout` y `/admin/login`. Sin CAPTCHA ni acortar la ventana de reserva por ahora (quedan como follow-up si hace falta).
- ~~Staff no puede cancelar un pedido manualmente.~~ **Resuelto** (2026-08-18): `cancelOrder()` + botón "Cancelar" en `/admin/pedidos`, para pedidos Pendiente/Reservado. Bloqueado para pedidos ya pagados (no hay mecanismo de reembolso en el sistema).
- ~~Al editar un producto cargado en el catálogo, solo permite editar precio, nombre y categoría. Debe dejar editar incluso variantes e imágenes.~~ **Resuelto** (2026-08-21): botón "Agregar variante" en `/admin/productos` (una variante nueva siempre arranca en stock 0, `/admin/caja` sigue siendo el único lugar para cargar stock).
- Al no poder eliminar una variante, no permite eliminar un producto cargado en catálogo aún así no haya stock disponible.
- ~~Una vez iniciada la sesión del admin, nunca se realiza cierra. Debe realizarse el logout mediante un botón o por cierre de pestaña.~~ **Resuelto** (2026-08-22): el botón "Salir" ya existía desde el inicio del proyecto (header de `/admin/*`). Sumado: la sesión ahora expira sola a las 8hs de inactividad (antes eran 30 días) — cierre exacto al cerrar pestaña no es viable sin desactivar el refresco de sesión interno de Auth.js.
- ~~En caso de querer eliminar una categoría que tiene elementos cargados, indica que primero se deben reasignar. Crear un acceso directo que permita la reasignación de el/los producto/s.~~ **Resuelto** (2026-08-23): link "Ver productos de esta categoría" en el mensaje de bloqueo, que lleva directo a `/admin/productos` filtrado por esa categoría (la reasignación por producto ya existía en el formulario de edición).
- ~~No existe botón para agregar imagen a un producto.~~ **Resuelto** (2026-08-21): galería de imágenes en `/admin/productos` — subir y borrar imágenes de un producto ya cargado (máximo 5 por producto).


## Problemas a corregir en el futuro

- Sin historial/reportes de ventas. `/admin/caja` solo muestra el estado actual (disponible/reservado/en depósito), no hay vista de "cuánto vendí hoy/esta semana" ni top productos.
- Un solo admin, sin gestión de usuarios.
- ~~Sin rate-limit/lockout en `/admin/login`.~~ **Resuelto** (2026-08-22): rate-limit de Nginx agregado. Sin lockout persistente, a propósito — para que nunca quedes bloqueada de tu propio panel.
