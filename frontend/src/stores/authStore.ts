import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, LoginCredentials, RegisterData, UserPreferences } from '../types';
import { authService } from '../services/auth.service';
import { usersService } from '../services/users.service';
import { connectSocket, disconnectSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  setAccessToken: (token: string) => void;
  updatePreferences: (preferences: UserPreferences) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,  // This should not be persisted

      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true });
        try {
          const { user, tokens } = await authService.login(credentials);
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
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
          const { user, tokens } = await authService.register(data);
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
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

      logout: () => {
        authService.logout().catch(console.error);
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
        disconnectSocket();
        toast.success('Logged out successfully');
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
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        // Exclude isLoading from persistence
      }),
    }
  )
);
