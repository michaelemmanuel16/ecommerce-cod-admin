import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, LoginCredentials, UserPreferences, Permissions } from '../types';
import { authService } from '../services/auth.service';
import { usersService } from '../services/users.service';
import { connectSocket, disconnectSocket, getSocket } from '../services/socket';
import { useAnalyticsStore } from './analyticsStore';
import { useDeliveryAgentsStore } from './deliveryAgentsStore';
import { useCustomerRepsStore } from './customerRepsStore';
import { useOrdersStore } from './ordersStore';
import { useNotificationsStore } from './notificationsStore';
import { clearBlockCache } from '../pages/financial/profit/useBlock';
import toast from 'react-hot-toast';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  permissions: Permissions | null;
  /** From /api/auth/me. null until the first answer; the sidebar shows placeholders meanwhile. */
  menu: string[] | null;
  homeRoute: string | null;
  roles: Array<{ id: number | null; name: string }> | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  registerTenant: (data: { companyName: string; adminEmail: string; adminPassword: string; adminName: string; planName?: string }) => Promise<void>;
  logout: (showToast?: boolean) => void;
  setAccessToken: (token: string, refreshToken?: string) => void;
  /** Merge saved profile fields into the signed-in user, so the header shows them at once. */
  patchUser: (fields: Partial<User>) => void;
  updatePreferences: (preferences: UserPreferences) => Promise<void>;
  refreshPermissions: () => Promise<void>;
  setupPermissionListener: () => void;
  initSocket: () => void;
  needsOnboarding: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      permissions: null,
      menu: null,
      homeRoute: null,
      roles: null,
      isAuthenticated: false,
      isLoading: false,  // This should not be persisted

      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true });
        try {
          const { user, tokens, permissions } = await authService.login(credentials);
          clearBlockCache(); // a new person signing in must not see the last person's cached Finance answers
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            permissions: permissions || null,
            isAuthenticated: true,
            isLoading: false,
          });
          toast.success(`Welcome back, ${user.firstName} ${user.lastName}!`);
          connectSocket();
          get().initSocket();
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      registerTenant: async (data) => {
        set({ isLoading: true });
        try {
          const { user, tokens } = await authService.registerTenant(data);
          clearBlockCache();
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            permissions: null,
            isAuthenticated: true,
            isLoading: false,
          });
          toast.success(`Welcome, ${user.firstName}! Let's set up your company.`);
          connectSocket();
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      needsOnboarding: () => {
        const { user, isAuthenticated } = get();
        if (!isAuthenticated || !user) return false;
        if (user.isPlatformAdmin) return false;
        // Only admin/super_admin should see the tenant setup wizard
        if (user.role !== 'super_admin') return false;
        const prefs = user.preferences as any;
        return !prefs?.onboardingCompleted;
      },

      logout: (showToast = true) => {
        authService.logout().catch(console.error);
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          permissions: null,
          menu: null,
          homeRoute: null,
          roles: null,
          isAuthenticated: false,
        });
        disconnectSocket();
        useNotificationsStore.getState().clearNotifications(); // the next person to sign in must not see this count
        clearBlockCache(); // nor the cached Finance answers
        if (showToast) {
          toast.success('Logged out successfully');
        }
      },

      // The server rotates the refresh token on every refresh (M3-T23): keep the new one
      setAccessToken: (token: string, refreshToken?: string) => {
        set(refreshToken ? { accessToken: token, refreshToken } : { accessToken: token });
      },

      patchUser: (fields: Partial<User>) => {
        const current = get().user;
        if (current) set({ user: { ...current, ...fields } });
      },

      updatePreferences: async (preferences: UserPreferences) => {
        try {
          const updatedPreferences = await usersService.updateUserPreferences(preferences);
          const currentUser = get().user;
          if (currentUser) {
            set({
              user: {
                ...currentUser,
                preferences: updatedPreferences,
              },
            });
          }
        } catch (error) {
          console.error('Failed to update preferences:', error);
          throw error;
        }
      },

      refreshPermissions: async () => {
        try {
          const { user, isAuthenticated } = get();
          if (!isAuthenticated || !user) {
            return;
          }

          const { permissions, menu, homeRoute, roles } = await authService.getMe();
          set({ permissions: permissions || null, menu: menu ?? null, homeRoute: homeRoute ?? null, roles: roles ?? null });
          console.log('[AuthStore] Permissions refreshed successfully');
        } catch (error) {
          console.error('[AuthStore] Failed to refresh permissions:', error);
        }
      },

      setupPermissionListener: () => {
        const socket = getSocket();
        if (!socket) {
          console.warn('[AuthStore] Socket not available for permission listener');
          return;
        }

        // Remove existing listener to prevent duplicates
        socket.off('permissions:updated');

        // Listen for permission updates from backend
        socket.on('permissions:updated', (event: { updatedRoles: string[]; timestamp: Date }) => {
          const { user, refreshPermissions } = get();

          if (!user) return;

          console.log('[AuthStore] Received permissions:updated event', event);

          // Check if current user's role was affected
          if (event.updatedRoles.includes(user.role)) {
            console.log('[AuthStore] User role affected, refreshing permissions...');

            // Refresh permissions immediately
            refreshPermissions();

            // Show notification to user
            toast.success('Your permissions have been updated', {
              duration: 5000,
              icon: '🔐',
            });
          }
        });

        console.log('[AuthStore] Permission listener setup complete');
      },

      initSocket: () => {
        let socketInstance = getSocket();
        if (!socketInstance) {
          socketInstance = connectSocket() || null;
        }

        if (!socketInstance) {
          console.warn('[AuthStore] Failed to initialize socket connection');
          return;
        }

        // Setup listeners for all stores
        get().setupPermissionListener();
        useAnalyticsStore.getState().setupSocketListeners();
        useDeliveryAgentsStore.getState().setupSocketListeners();
        useCustomerRepsStore.getState().setupSocketListeners();
        useOrdersStore.getState().setupSocketListeners();
        useNotificationsStore.getState().setupSocketListeners();

        console.log('[AuthStore] All socket listeners initialized');
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        permissions: state.permissions,
        menu: state.menu,
        homeRoute: state.homeRoute,
        roles: state.roles,
        isAuthenticated: state.isAuthenticated,
        // Exclude isLoading from persistence
      }),
    }
  )
);
