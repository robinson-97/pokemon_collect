// Pure logica voor de kaartscanner: tekst van de OCR omzetten naar kaartnummer/naam en kaarten zoeken.

// '025/165' -> {num:'25', den:'165'}; 'TG12/TG30' -> {prefix:'TG', num:'12', den:'30'}; 'SVP 045' -> {prefix:'SVP', num:'45'}
export function parseCardNumber(text) {
  const t = String(text || '').toUpperCase();
  const full = [...t.matchAll(/([A-Z]{0,4})\s?0*(\d{1,3})\s*[\/|\\]\s*[A-Z]{0,4}\s?(\d{2,3})/g)];
  // bij meerdere treffers: de eerste met een geldige verhouding (nummer mag boven de totaalwaarde liggen bij secret rares)
  for (const m of full) {
    const num = m[2], den = m[3];
    if (Number(den) >= 10 && Number(num) >= 1) return { prefix: m[1] || '', num: String(Number(num)), den: String(Number(den)) };
  }
  const promo = t.match(/\b(SVP|SWSH|SM|XY|BW|HGSS|DP|PR|TG|GG)\s?-?\s?0*(\d{1,3})\b/);
  if (promo) return { prefix: promo[1], num: String(Number(promo[2])), den: null };
  return null;
}

// Naam: de langste regel met genoeg letters, zonder ruis zoals 'BASIC Pokémon' of HP.
export function cleanName(text) {
  const lines = String(text || '').split(/\n+/).map(l => l
    .replace(/\b(basic|stage\s*[12]|vmax|vstar|mega|pok[eé]mon)\b/gi, ' ')
    .replace(/\bHP\s*\d+/gi, ' ')
    .replace(/[^A-Za-zÀ-ÿ'’\s.-]/g, ' ')
    .replace(/\s+/g, ' ').trim());
  return lines.filter(l => l.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3).sort((a, b) => b.length - a.length)[0] || '';
}

const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// 0..1; 1 = gelijk. Een naam die in de andere zit ('Pikachu ex' vs 'Pikachu') scoort hoog.
export function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

const numKey = n => String(n).toUpperCase().replace(/^([A-Z]*)0*(\d)/, '$1$2');
const sameNumber = (card, p) => numKey(card.number) === numKey(`${p.prefix || ''}${p.num}`);
const setMatchesTotal = (set, den) => !den || String(set.printedTotal) === String(den) || String(set.total) === String(den);

// Zoekt kaarten bij een gelezen nummer (en eventueel naam).
// trackedSets: sets die de gebruiker spaart; otherSets: alle overige sets; getCards(set) -> kaarten.
export async function findCandidates({ parsed, name, trackedSets, otherSets = [], getCards, maxOtherSets = 6 }) {
  const out = [];
  const scoreOf = card => 1 + (name ? similarity(card.name, name) : 0);
  async function scan(sets, tracked) {
    for (const set of sets) {
      let cards;
      try { cards = await getCards(set); } catch { continue; }
      for (const card of cards) {
        if (parsed ? sameNumber(card, parsed) : name && similarity(card.name, name) >= 0.8) {
          out.push({ card, set, tracked, score: parsed ? scoreOf(card) : similarity(card.name, name) });
        }
      }
    }
  }
  const tracked = trackedSets.filter(s => !parsed || setMatchesTotal(s, parsed.den));
  await scan(tracked, true);
  // Alleen buiten je eigen sets zoeken als daar niets is gevonden en het totaal bekend is.
  if (!out.length && parsed?.den) await scan(otherSets.filter(s => setMatchesTotal(s, parsed.den)).slice(0, maxOtherSets), false);
  return out.sort((a, b) => b.score - a.score || Number(b.tracked) - Number(a.tracked)).slice(0, 5);
}

// Invoer uit het zoekveld: "25/165", "tg12" of een naam.
export function parseManual(text) {
  const parsed = parseCardNumber(text);
  if (parsed) return { parsed, name: cleanName(String(text).replace(/\d+\s*\/\s*\d+/g, ' ')) };
  return { parsed: null, name: cleanName(text) || String(text).trim() };
}
