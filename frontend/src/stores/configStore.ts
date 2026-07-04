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
            // THIS tenant's currency. The public /config route is tenant-blind and
            // falls back to the global USD row (that mismatch was the "$ everywhere"
            // bug). Token-less surfaces (iframe/checkout bootstrap) use /config.
            const isAuthenticated = Boolean(useAuthStore.getState().accessToken);
            const config = isAuthenticated
                ? await adminService.getTenantConfig()
                : await adminService.getPublicConfig();
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
