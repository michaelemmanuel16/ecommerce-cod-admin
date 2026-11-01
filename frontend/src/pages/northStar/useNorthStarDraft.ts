import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { targetsService, type Calculators, type Drivers, type GrowthMode, type SplitPreview, type Tree } from '../../services/targets.service';
import { useConfigStore } from '../../stores/configStore';
import { todayYmd } from '../../utils/format';
import { apiMessage } from '../orders/importText';
import { DEFAULT_ANNUAL, DEFAULT_MARGIN, customGap, customQuarters, hasPastMonths, inferMode, parseNumber } from './model';

const DEBOUNCE_MS = 300;

/** The same effect after a pause: a keystroke does not ask the API, the pause after it does. */
function useDebounced(effect: () => void | (() => void), deps: unknown[]) {
  useEffect(() => {
    let cleanup: void | (() => void);
    const timer = setTimeout(() => { cleanup = effect(); }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); if (typeof cleanup === 'function') cleanup(); };
  }, deps);
}

export interface NorthStarDraft {
  loaded: boolean;
  loadError: string | null;
  year: number;
  currency: string;
  annual: string; setAnnual: (v: string) => void;
  mode: GrowthMode; setMode: (m: GrowthMode) => void;
  custom: string[]; setCustom: (i: number, v: string) => void;
  margin: string; setMargin: (v: string) => void;
  confirmation: string; setConfirmation: (v: string) => void;
  success: string; setSuccess: (v: string) => void;
  aov: string; setAov: (v: string) => void;
  aovSource: 'auto' | 'manual';
  /** The default from the last 30 days; null when nothing was delivered (the field is then required). */
  last30Days: number | null;
  resetAov: () => void;
  /** The tree as it is saved, and when the North Star was last set. */
  saved: Tree | null;
  setOn: string | null;
  pastMonths: boolean;
  preview: SplitPreview | null;
  gap: number | null;
  calc: Calculators | null;
  calcError: string | null;
  /** Why a save is blocked, in words; empty when it can go. */
  problems: string[];
  save: () => Promise<void>;
  reload: () => void;
}

/**
 * The inputs of the North Star (F-1111, F-1112, F-1113) shared by the wizard step and the Settings tab. It loads the saved
 * drivers and tree, asks the API for the split of what is typed (the API does the arithmetic) and for the calculator tiles, and saves
 * the tree and the drivers. Nothing here works out a quarter or an orders-a-day figure.
 */
export function useNorthStarDraft(year: number): NorthStarDraft {
  const currency = useConfigStore((s) => s.currency) || 'GHS';
  const today = todayYmd();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Tree | null>(null);
  const [annual, setAnnual] = useState(DEFAULT_ANNUAL);
  const [mode, setModeState] = useState<GrowthMode>('grow');
  const [custom, setCustomTexts] = useState<string[]>(['', '', '', '']);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [confirmation, setConfirmation] = useState('70');
  const [success, setSuccess] = useState('60');
  const [aov, setAovText] = useState('');
  const [aovSource, setAovSource] = useState<'auto' | 'manual'>('auto');
  const [last30Days, setLast30Days] = useState<number | null>(null);
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [calc, setCalc] = useState<Calculators | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const customRef = useRef(custom);
  customRef.current = custom;

  // Load what is saved: the drivers, the tree, and which mode the saved quarters follow
  useEffect(() => {
    let alive = true;
    (async () => {
      const [drivers, tree] = await Promise.all([targetsService.drivers(year), targetsService.tree(year)]);
      if (!alive) return;
      applyDrivers(drivers);
      setSaved(tree);
      if (tree.northStar) {
        const value = tree.northStar.value;
        setAnnual(String(value));
        const quarters = tree.quarters.map((q) => q.value);
        const [even, grow] = await Promise.all([targetsService.preview(year, value, 'even'), targetsService.preview(year, value, 'grow')]);
        if (!alive) return;
        const found = inferMode(quarters, even.quarters.map(Number), grow.quarters.map(Number));
        setModeState(found);
        if (found === 'custom') setCustomTexts(quarters.map(String));
      }
      setLoaded(true);
    })().catch(async (err) => {
      if (alive) setLoadError(await apiMessage(err, 'Could not load your North Star. Refresh the page to try again.'));
    });
    return () => { alive = false; };
  }, [year, version]);

  function applyDrivers(d: Drivers) {
    setMargin(String(d.netMargin.value));
    setConfirmation(String(d.confirmationRate.value));
    setSuccess(String(d.deliverySuccessRate.value));
    setLast30Days(d.plannedAov.last30Days);
    setAovSource(d.plannedAov.source);
    setAovText(d.plannedAov.value === null ? '' : String(d.plannedAov.value));
  }

  const annualNumber = parseNumber(annual);
  const gap = mode === 'custom' ? customGap(annualNumber, custom) : null;
  const typedQuarters = customQuarters(custom);

  // The split of what is typed. Custom asks only once the quarters add up.
  useDebounced(() => {
    if (!loaded || annualNumber === null || annualNumber <= 0 || (mode === 'custom' && (gap !== 0 || typedQuarters === null))) { setPreview(null); return; }
    let alive = true;
    targetsService.preview(year, annualNumber, mode, mode === 'custom' ? typedQuarters ?? undefined : undefined)
      .then((p) => { if (alive) setPreview(p); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [loaded, year, annualNumber, mode, gap, custom.join('|')]);

  // The calculator tiles for this month, from the split above and the drivers typed
  const monthNo = Number(today.slice(5, 7));
  const thisMonth = preview?.months[Math.floor((monthNo - 1) / 3)]?.[(monthNo - 1) % 3];
  const monthValue = thisMonth === undefined ? null : Number(thisMonth);
  const aovNumber = parseNumber(aov);
  const confNumber = parseNumber(confirmation);
  const successNumber = parseNumber(success);
  useDebounced(() => {
    if (!loaded || monthValue === null) { setCalc(null); setCalcError(null); return; }
    let alive = true;
    targetsService.calculators({
      month: `${year}-${String(monthNo).padStart(2, '0')}`, revenueTarget: monthValue,
      ...(aovNumber !== null && aovNumber > 0 && { aov: aovNumber }),
      ...(confNumber !== null && { confirmationRate: confNumber }), ...(successNumber !== null && { deliverySuccessRate: successNumber }),
    })
      .then((c) => { if (alive) { setCalc(c); setCalcError(null); } })
      .catch(async (err) => { if (alive) { setCalc(null); setCalcError(await apiMessage(err, 'The tiles could not be worked out.')); } });
    return () => { alive = false; };
  }, [loaded, year, monthValue, aovNumber, confNumber, successNumber]);

  const problems = useMemo(() => {
    const out: string[] = [];
    if (annualNumber === null || annualNumber <= 0) out.push('Enter the annual North Star: more than 0.');
    if (mode === 'custom' && (typedQuarters === null || gap !== 0)) out.push('The four quarters must add up to the annual figure.');
    for (const [label, v] of [['Confirmation rate', confNumber], ['Delivery success rate', successNumber], ['Net margin', parseNumber(margin)]] as const) {
      if (v === null || v <= 0 || v > 100) out.push(`${label} must be more than 0 and not more than 100.`);
    }
    if (aovNumber === null || aovNumber <= 0) out.push(last30Days === null ? 'Enter the planned average order: no orders were delivered in the last 30 days, so there is no default.' : 'Enter the planned average order.');
    return out;
  }, [annualNumber, mode, typedQuarters, gap, confNumber, successNumber, margin, aovNumber, last30Days]);

  const save = useCallback(async () => {
    const value = annualNumber as number;
    // A typed AOV is saved with the tree; one back on the last 30 days is cleared with the drivers.
    await targetsService.saveNorthStar({
      year, annual: value, mode, ...(mode === 'custom' && typedQuarters && { customQuarters: typedQuarters }),
      ...(aovSource === 'manual' && aovNumber !== null && { plannedAov: aovNumber }),
    });
    await targetsService.saveDrivers(year, {
      confirmationRate: confNumber as number, deliverySuccessRate: successNumber as number, netMargin: parseNumber(margin) as number,
      ...(aovSource === 'auto' && { plannedAov: null }),
    });
  }, [annualNumber, aovNumber, aovSource, confNumber, margin, mode, successNumber, typedQuarters, year]);

  return {
    loaded, loadError, year, currency,
    annual, setAnnual, mode, custom,
    // Custom starts from the split on screen, so the person edits it instead of typing four numbers from nothing
    setMode: (m) => {
      if (m === 'custom' && preview && custom.every((c) => c === '')) setCustomTexts(preview.quarters.map((q) => String(Number(q))));
      setModeState(m);
    },
    setCustom: (i, v) => setCustomTexts((c) => c.map((x, j) => (j === i ? v : x))),
    margin, setMargin, confirmation, setConfirmation, success, setSuccess,
    aov, setAov: (v) => { setAovText(v); setAovSource('manual'); }, aovSource, last30Days,
    resetAov: () => { setAovText(last30Days === null ? '' : String(last30Days)); setAovSource('auto'); },
    saved, setOn: saved?.northStar?.updatedAt.slice(0, 10) ?? null, pastMonths: hasPastMonths(saved?.months ?? [], today.slice(0, 7)),
    preview, gap, calc, calcError, problems, save, reload: () => { setLoaded(false); setVersion((v) => v + 1); },
  };
}
