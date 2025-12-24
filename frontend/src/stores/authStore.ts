import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, LoginCredentials, RegisterData, UserPreferences, Permissions } from '../types';
import { authService } from '../services/auth.service';
import { usersService } from '../services/users.service';
import { connectSocket, disconnectSocket, getSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  permissions: Permissions | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: (showToast?: boolean) => void;
  setAccessToken: (token: string) => void;
  updatePreferences: (preferences: UserPreferences) => Promise<void>;
  refreshPermissions: () => Promise<void>;
  setupPermissionListener: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      permissions: null,
      isAuthenticated: false,
      isLoading: false,  // This should not be persisted

      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true });
        try {
          const { user, tokens, permissions } = await authService.login(credentials);
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
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (data: RegisterData) => {
        set({ isLoading: true });
        try {
          const { user, tokens, permissions } = await authService.register(data);
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            permissions: permissions || null,
            isAuthenticated: true,
            isLoading: false,
          });
          toast.success(`Welcome, ${user.firstName} ${user.lastName}!`);
          connectSocket();
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: (showToast = true) => {
        authService.logout().catch(console.error);
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          permissions: null,
          isAuthenticated: false,
        });
        disconnectSocket();
        if (showToast) {
          toast.success('Logged out successfully');
        }
      },

      setAccessToken: (token: string) => {
        set({ accessToken: token });
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

          const { permissions } = await authService.getMe();
          set({ permissions: permissions || null });
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
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        permissions: state.permissions,
        isAuthenticated: state.isAuthenticated,
        // Exclude isLoading from persistence
      }),
    }
  )
);
