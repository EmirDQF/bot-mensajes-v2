// Reloj único del bot. En producción es la hora real; scripts/simulate-conversations.js lo fija
// para simular, por ejemplo, un mensaje a las 10:30 p. m.
let source = () => new Date();

export function now() {
  return source();
}

export function setClock(fn) {
  source = typeof fn === 'function' ? fn : () => new Date();
}

export default { now, setClock };
