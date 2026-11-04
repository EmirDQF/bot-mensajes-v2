// Cola por paciente: las tareas de una misma clave corren en orden y de a una. Si una tarea falla, el
// error va a onError y la siguiente igual se ejecuta (un fallo nunca deja mudo al paciente).
// enqueue() devuelve una promesa que nunca se rechaza.

export function createSerialQueue({ onError = () => {} } = {}) {
  const tails = new Map();

  function report(error, key) {
    try { onError(error, key); } catch { /* el log nunca corta la cola */ }
  }

  function enqueue(key, work) {
    const previous = tails.get(key) || Promise.resolve();
    const tracked = previous
      .then(work)
      .catch((error) => report(error, key))
      .finally(() => { if (tails.get(key) === tracked) tails.delete(key); });
    tails.set(key, tracked);
    return tracked;
  }

  // Promesa de lo pendiente de una clave (o null si no hay nada en curso).
  const pending = (key) => tails.get(key) || null;

  return { enqueue, pending };
}

export default createSerialQueue;
