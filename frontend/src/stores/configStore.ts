import { create } from 'zustand';
import { adminService } from '../services/admin.service';

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
            const config = await adminService.getPublicConfig();
            set({
                businessName: config.businessName || 'COD Admin',
                currency: config.currency || 'USD',
                isLoading: false,
            });
        } catch (error) {
            console.error('Failed to fetch public config:', error);
            set({ isLoading: false });
        }
    },
}));
