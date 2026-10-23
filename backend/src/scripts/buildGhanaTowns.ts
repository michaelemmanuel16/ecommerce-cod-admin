/**
 * One-off generator for backend/src/data/towns/GH.ts (the Ghana City/Town lists, COD-138).
 * Kept so the list can be rebuilt and reviewed. The generated file is the source of truth at runtime.
 *
 * Inputs
 *   1. GeoNames GH.txt + admin1CodesASCII.txt (downloaded, never committed). Populated places
 *      (feature class P) with population >= 15,000, plus every regional capital.
 *   2. NEIGHBOURHOODS: names customers really type that GeoNames misses (Accra, Kumasi, Takoradi, Central).
 *   3. PAST_DATA: town names seen 3+ times in dev customers.area / orders.delivery_area, mapped to the
 *      state where each name appears most.
 *
 * Run: npx ts-node src/scripts/buildGhanaTowns.ts <GH.txt> <admin1.txt>
 * Contains data from GeoNames (geonames.org), CC BY 4.0.
 */
import fs from 'fs';
import path from 'path';
import { State } from 'country-state-city';

const MIN_POPULATION = 15000;

// GeoNames spellings -> the spelling customers use. A null target drops the row.
const RENAMES: Record<string, string | null> = {
  Atsiaman: 'Ashaiman',
  'Medina Estates': 'Madina',
  'Teshi Old Town': 'Teshie',
  'Tema New Town': null,
  'New Achimota': 'Achimota',
  Sakumona: 'Sakumono',
  Obuase: 'Obuasi',
  Mankesim: 'Mankessim',
  'Shama Junction': 'Shama',
  'Sekondi-Takoradi': null,
  'Assin Foso': 'Foso',
};

const REGIONAL_CAPITALS: Record<string, string[]> = {
  'Greater Accra': ['Accra'],
  Ashanti: ['Kumasi'],
  Western: ['Sekondi', 'Takoradi'],
  'Western North': ['Sefwi Wiawso'],
  Central: ['Cape Coast'],
  Eastern: ['Koforidua'],
  Volta: ['Ho'],
  Oti: ['Dambai'],
  Northern: ['Tamale'],
  Savannah: ['Damongo'],
  'North East': ['Nalerigu'],
  'Upper East': ['Bolgatanga'],
  'Upper West': ['Wa'],
  Bono: ['Sunyani'],
  'Bono East': ['Techiman'],
  Ahafo: ['Goaso'],
};

const NEIGHBOURHOODS: Record<string, string[]> = {
  'Greater Accra': [
    'Madina', 'Adenta', 'Spintex', 'Osu', 'Labadi', 'Teshie', 'Nungua', 'Dansoman', 'Kaneshie', 'Achimota',
    'Lapaz', 'Dome', 'Kwabenya', 'Taifa', 'Pokuase', 'Amasaman', 'Weija', 'Gbawe', 'Mallam', 'Kokrobite',
    'Ablekuma', 'Odorkor', 'Darkuman', 'Abeka', 'Kotobabi', 'Nima', 'Dzorwulu', 'Airport Residential',
    'Cantonments', 'Labone', 'East Legon', 'Legon', 'Haatso', 'Agbogba', 'Ashongman', 'Oyarifa', 'Oyibi',
    'Dodowa', 'Afienya', 'Prampram', 'Sakumono', 'Lashibi', 'Kpone', 'Ashaiman', 'Adabraka', 'Makola',
    'Jamestown', 'Chorkor', 'Mamprobi', 'Korle Bu', 'Bortianor', 'Botwe', 'Ada', 'Tema', 'Accra', 'Kasoa',
  ],
  Ashanti: [
    'Kumasi', 'Adum', 'Kejetia', 'Asokwa', 'Ahodwo', 'Suame', 'Tafo', 'Bantama', 'Santasi', 'Kwadaso',
    'Atonsu', 'Ayigya', 'Ayeduase', 'Bomso', 'Aboabo', 'Oforikrom', 'Ejisu', 'Obuasi', 'Konongo', 'Bekwai',
    'Mampong', 'Effiduase', 'Offinso', 'Ejura', 'Tanoso', 'Abuakwa',
  ],
  Western: [
    'Takoradi', 'Sekondi', 'Tarkwa', 'Anaji', 'Fijai', 'Effia', 'Kojokrom', 'Apowa', 'Market Circle',
    'Prestea', 'Bogoso', 'Axim', 'Shama',
  ],
  Central: [
    'Cape Coast', 'Kasoa', 'Winneba', 'Swedru', 'Mankessim', 'Saltpond', 'Elmina', 'Apam', 'Dunkwa', 'Foso',
  ],
};

// Dev data, 3+ rows each, state = where the name appears most (customers + orders).
const PAST_DATA: Record<string, string[]> = {
  'Greater Accra': ['Accra', 'Osu', 'Teshie', 'Lapaz', 'Spintex', 'Tema', 'East Legon', 'Madina', 'Dansoman'],
  Ashanti: ['Kejetia', 'Ahodwo', 'Adum', 'Asokwa'],
  Western: ['Takoradi', 'Market Circle', 'Anaji'],
  Central: ['Cape Coast', 'Abura', 'Pedu'],
};

function main(): void {
  const [geonamesPath, admin1Path] = process.argv.slice(2);
  if (!geonamesPath || !admin1Path) {
    console.error('Usage: npx ts-node src/scripts/buildGhanaTowns.ts <GH.txt> <admin1.txt>');
    process.exit(1);
  }
  const stateNames = State.getStatesOfCountry('GH').map((s) => s.name);

  // admin1 code ("01") -> state name, checked against country-state-city.
  const admin1: Record<string, string> = {};
  for (const line of fs.readFileSync(admin1Path, 'utf8').split('\n')) {
    const [key, name] = line.split('\t');
    if (key?.startsWith('GH.')) admin1[key.slice(3)] = name;
  }
  for (const name of Object.values(admin1)) {
    if (!stateNames.includes(name)) throw new Error(`GeoNames state "${name}" is not a country-state-city state`);
  }

  const towns: Record<string, Map<string, string>> = {};
  for (const s of stateNames) towns[s] = new Map();
  const add = (state: string, raw: string): void => {
    const name = raw in RENAMES ? RENAMES[raw] : raw;
    if (!name || !towns[state]) return;
    const key = name.toLowerCase();
    if (!towns[state].has(key)) towns[state].set(key, name);
  };

  for (const line of fs.readFileSync(geonamesPath, 'utf8').split('\n')) {
    const c = line.split('\t');
    if (c.length < 15 || c[6] !== 'P') continue;
    const state = admin1[c[10]];
    if (state && Number(c[14]) >= MIN_POPULATION) add(state, c[1]);
  }
  for (const [state, names] of Object.entries(REGIONAL_CAPITALS)) names.forEach((n) => add(state, n));
  for (const [state, names] of Object.entries(NEIGHBOURHOODS)) names.forEach((n) => add(state, n));
  for (const [state, names] of Object.entries(PAST_DATA)) names.forEach((n) => add(state, n));
  // Kasoa sits on the Central / Greater Accra border; list it under both.
  add('Greater Accra', 'Kasoa');
  add('Central', 'Kasoa');

  const body = stateNames
    .map((s) => {
      const list = [...towns[s].values()].sort((a, b) => a.localeCompare(b));
      return `  ${JSON.stringify(s)}: [\n${list.map((t) => `    ${JSON.stringify(t)},`).join('\n')}\n  ],`;
    })
    .join('\n');

  const out = `// Contains data from GeoNames (geonames.org), CC BY 4.0.
// Generated by src/scripts/buildGhanaTowns.ts (COD-138). Edit the script inputs, then regenerate.
// Keys are the state names exactly as country-state-city spells them.
export const GH_TOWNS: Record<string, string[]> = {
${body}
};
`;
  const target = path.join(__dirname, '..', 'data', 'towns', 'GH.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out);
  for (const s of stateNames) console.log(`${s}: ${towns[s].size}`);
}

main();
