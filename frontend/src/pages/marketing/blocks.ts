import { metaAdsService } from '../../services/metaAds.service';
import { marketingService, type DayRange } from '../../services/marketing.service';
import { useBlock } from '../financial/profit/useBlock';

// One hook per block, keyed by the range. They share useBlock's cache, so refreshBlocks() after a saved mapping makes
// the campaigns, products, unmapped and funnel blocks ask again at once.
const k = (name: string, r: DayRange) => `mkt|${name}|${r.from}|${r.to}`;
export const useAccounts = () => useBlock('mkt|accounts', () => metaAdsService.getAccounts());
export const useSummary = (r: DayRange, enabled: boolean) => useBlock(k('summary', r), () => marketingService.summary(r), enabled);
export const useFunnel = (r: DayRange, productId: number | null, enabled: boolean) => useBlock(`${k('funnel', r)}|${productId ?? 'all'}`, () => marketingService.funnel(r, productId), enabled);
export const useProducts = (r: DayRange, enabled: boolean) => useBlock(k('products', r), () => marketingService.products(r), enabled);
export const useCampaigns = (r: DayRange, enabled: boolean) => useBlock(k('campaigns', r), () => marketingService.campaigns(r), enabled);
export const useUnmapped = (r: DayRange, enabled: boolean) => useBlock(k('unmapped', r), () => marketingService.unmapped(r), enabled);
