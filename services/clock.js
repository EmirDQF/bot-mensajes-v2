import { testMode } from './testContext.js';

// Reloj único del bot. En producción es la hora real; scripts/simulate-conversations.js lo fija
// para simular, por ejemplo, un mensaje a las 10:30 p. m. El Probador del panel usa un desfase
// solo dentro de su conversación de prueba (services/testContext.js).
let source = () => new Date();

export function now() {
  const offset = testMode()?.clockOffsetMs;
  return offset ? new Date(source().getTime() + offset) : source();
}

export function setClock(fn) {
  source = typeof fn === 'function' ? fn : () => new Date();
}

export default { now, setClock };
