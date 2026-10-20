import { create } from 'zustand';
import { adminService } from '../services/admin.service';
import { useAuthStore } from './authStore';

interface ConfigState {
    businessName: string;
    currency: string;
    isLoading: boolean;
    fetchConfig: (formSlug?: string) => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
    businessName: 'COD Admin',
    currency: 'USD',
    isLoading: false,

    fetchConfig: async (formSlug) => {
        set({ isLoading: true });
        try {
            // Signed in: the tenant-scoped config, so the dashboard shows THIS tenant's
            // currency. Signed out: the public form page passes its form slug. Other
            // token-less pages have no tenant and keep the defaults.
            const isAuthenticated = Boolean(useAuthStore.getState().accessToken);
            let config;
            if (isAuthenticated) config = await adminService.getTenantConfig();
            else if (formSlug) config = await adminService.getPublicConfig(formSlug);
            else {
                set({ isLoading: false });
                return;
            }
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
