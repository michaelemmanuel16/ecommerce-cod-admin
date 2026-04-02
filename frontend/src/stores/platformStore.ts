import { create } from 'zustand';
import { platformService, PlatformMetrics, TrendData, TenantListItem, TenantDetail, Announcement } from '../services/platform.service';
import toast from 'react-hot-toast';

interface PlatformState {
  metrics: PlatformMetrics | null;
  trends: TrendData[];
  tenants: TenantListItem[];
  tenantsTotal: number;
  tenantsPage: number;
  tenantsTotalPages: number;
  currentTenant: TenantDetail | null;
  announcements: Announcement[];
  isLoading: boolean;

  fetchMetrics: () => Promise<void>;
  fetchTrends: (period?: string) => Promise<void>;
  fetchTenants: (params?: { search?: string; plan?: string; status?: string; page?: number }) => Promise<void>;
  fetchTenant: (id: string) => Promise<void>;
  createTenant: (data: { name: string; slug: string; planName?: string; region?: string; currency?: string }) => Promise<void>;
  updateTenant: (id: string, data: Record<string, any>) => Promise<void>;
  suspendTenant: (id: string) => Promise<void>;
  reactivateTenant: (id: string) => Promise<void>;
  deleteTenant: (id: string, confirmSlug: string) => Promise<void>;
  fetchAnnouncements: () => Promise<void>;
  createAnnouncement: (data: { title: string; body: string; type?: string; expiresAt?: string }) => Promise<void>;
  deleteAnnouncement: (id: string) => Promise<void>;
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  metrics: null,
  trends: [],
  tenants: [],
  tenantsTotal: 0,
  tenantsPage: 1,
  tenantsTotalPages: 1,
  currentTenant: null,
  announcements: [],
  isLoading: false,

  fetchMetrics: async () => {
    try {
      const metrics = await platformService.getMetrics();
      set({ metrics });
    } catch { toast.error('Failed to load platform metrics'); }
  },

  fetchTrends: async (period = '30d') => {
    try {
      const { data } = await platformService.getTrends(period);
      set({ trends: data });
    } catch { toast.error('Failed to load trends'); }
  },

  fetchTenants: async (params) => {
    set({ isLoading: true });
    try {
      const result = await platformService.listTenants(params);
      set({ tenants: result.tenants, tenantsTotal: result.total, tenantsPage: result.page, tenantsTotalPages: result.totalPages });
    } catch { toast.error('Failed to load tenants'); }
    finally { set({ isLoading: false }); }
  },

  fetchTenant: async (id) => {
    set({ isLoading: true });
    try {
      const tenant = await platformService.getTenant(id);
      set({ currentTenant: tenant });
    } catch { toast.error('Failed to load tenant'); }
    finally { set({ isLoading: false }); }
  },

  createTenant: async (data) => {
    try {
      await platformService.createTenant(data);
      toast.success('Tenant created');
      get().fetchTenants();
    } catch {
      toast.error('Failed to create tenant');
    }
  },

  updateTenant: async (id, data) => {
    try {
      await platformService.updateTenant(id, data);
      toast.success('Tenant updated');
      get().fetchTenant(id);
    } catch {
      toast.error('Failed to update tenant');
    }
  },

  suspendTenant: async (id) => {
    try {
      await platformService.suspendTenant(id);
      toast.success('Tenant suspended');
      get().fetchTenant(id);
    } catch {
      toast.error('Failed to suspend tenant');
    }
  },

  reactivateTenant: async (id) => {
    try {
      await platformService.reactivateTenant(id);
      toast.success('Tenant reactivated');
      get().fetchTenant(id);
    } catch {
      toast.error('Failed to reactivate tenant');
    }
  },

  deleteTenant: async (id, confirmSlug) => {
    try {
      await platformService.deleteTenant(id, confirmSlug);
      toast.success('Tenant deleted');
      get().fetchTenants();
    } catch {
      toast.error('Failed to delete tenant');
    }
  },

  fetchAnnouncements: async () => {
    try {
      const { announcements } = await platformService.listAnnouncements();
      set({ announcements });
    } catch { toast.error('Failed to load announcements'); }
  },

  createAnnouncement: async (data) => {
    try {
      await platformService.createAnnouncement(data);
      toast.success('Announcement created');
      get().fetchAnnouncements();
    } catch {
      toast.error('Failed to create announcement');
    }
  },

  deleteAnnouncement: async (id) => {
    try {
      await platformService.deleteAnnouncement(id);
      toast.success('Announcement deleted');
      get().fetchAnnouncements();
    } catch {
      toast.error('Failed to delete announcement');
    }
  },
}));
