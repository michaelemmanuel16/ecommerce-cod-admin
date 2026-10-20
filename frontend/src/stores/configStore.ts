import { create } from 'zustand';
import { adminService } from '../services/admin.service';
import { useAuthStore } from './authStore';

interface ConfigState {
    businessName: string;
    currency: string;
    isLoading: boolean;
    fetchConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
    businessName: 'COD Admin',
    currency: 'USD',
    isLoading: false,

    fetchConfig: async () => {
        set({ isLoading: true });
        try {
            // When signed in, fetch the tenant-scoped config so the dashboard shows
            // THIS tenant's currency. The public /config route needs a slug: the
            // public form page (/form/<slug>) passes its form slug. Other token-less
            // pages have no tenant, so they keep the defaults.
            const isAuthenticated = Boolean(useAuthStore.getState().accessToken);
            const formSlug = window.location.pathname.match(/^\/form\/([^/]+)/)?.[1];
            if (!isAuthenticated && !formSlug) {
                set({ isLoading: false });
                return;
            }
            const config = isAuthenticated
                ? await adminService.getTenantConfig()
                : await adminService.getPublicConfig(formSlug!);
            set({
                businessName: config.businessName || 'COD Admin',
                currency: config.currency || 'USD',
                isLoading: false,
            });
        } catch (error) {
            console.error('Failed to fetch config:', error);
            set({ isLoading: false });
        }
    },
}));
