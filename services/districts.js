// Centralized districts list and helpers
const DISTRICTS = [
  'cercado de lima','lima','ancon','ate','barranco','breña','carabayllo','chaclacayo','chorrillos','cieneguilla','comas','el agustino','independencia','jesus maria','la molina','la victoria','lince','los olivos','lica a','magdalena del mar','miraflores','pachacamac','pucusana','puente piedra','punta negra','punta hermosa','rimac','san borja','san isidro','san juan de lurigancho','san juan de miraflores','san luis','san martín de porres','san miguel','santa anita','santa maria del mar','santa rosa','santiago de surco','surco','surquillo','venta','villa el salvador','villa maria del triunfo'
].map(s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim());

function normalizeText(s) {
  if (!s || typeof s !== 'string') return '';
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: an + 1 }, () => Array(bn + 1).fill(0));
  for (let i = 0; i <= an; i++) matrix[i][0] = i;
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;
  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[an][bn];
}

function isValidDistrict(text) {
  if (!text || typeof text !== 'string') return false;
  const t = normalizeText(text);
  // exact includes
  for (const d of DISTRICTS) {
    if (t === d) return true;
    if (t.includes(d) || d.includes(t)) return true;
  }
  // fuzzy check (distance <=2)
  for (const d of DISTRICTS) {
    const dist = levenshtein(t, d);
    if (dist <= 2) return true;
  }
  return false;
}

export { DISTRICTS, normalizeText, levenshtein, isValidDistrict };
