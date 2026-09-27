// Supabase (PostgREST) devuelve como máximo 1000 filas por consulta: sin paginar, las métricas y el
// resumen diario contarían de menos en una clínica con volumen. makeQuery() debe devolver una consulta nueva.
export async function fetchAllRows(makeQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

export default fetchAllRows;
