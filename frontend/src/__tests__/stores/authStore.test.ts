import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/auth.service';

// Mock the auth service
vi.mock('../../services/auth.service', () => ({
  authService: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

describe('Auth Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,
      isAuthenticated: false,
      permissions: null,
    });
    vi.clearAllMocks();
  });

  it('should initialize with null user and token', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  it('should handle successful login', async () => {
    const mockResponse = {
      user: {
        id: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin',
      },
      tokens: {
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123',
      },
      permissions: null,
    };

    vi.mocked(authService.login).mockResolvedValue(mockResponse);

    const { login } = useAuthStore.getState();
    await login({ email: 'test@example.com', password: 'password123' });

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockResponse.user);
    expect(state.accessToken).toBe('access_token_123');
    expect(state.refreshToken).toBe('refresh_token_123');
    expect(state.isLoading).toBe(false);
  });

  it('should handle login error', async () => {
    const mockError = new Error('Invalid credentials');

    vi.mocked(authService.login).mockRejectedValue(mockError);

    const { login } = useAuthStore.getState();

    await expect(
      login({ email: 'test@example.com', password: 'wrongpassword' })
    ).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
  });

  it('should handle successful registration', async () => {
    const mockResponse = {
      user: {
        id: '456',
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
        role: 'customer_rep',
      },
      tokens: {
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token',
      },
      permissions: null,
    };

    vi.mocked(authService.register).mockResolvedValue(mockResponse);

    const { register } = useAuthStore.getState();
    await register({
      email: 'new@example.com',
      password: 'password123',
      firstName: 'New',
      lastName: 'User',
    });

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockResponse.user);
    expect(state.accessToken).toBe('new_access_token');
  });

  it('should clear user data on logout', () => {
    // Set initial state
    useAuthStore.setState({
      user: { id: '123', email: 'test@example.com' } as any,
      accessToken: 'token_123',
      refreshToken: 'refresh_123',
    });

    vi.mocked(authService.logout).mockResolvedValue(undefined);

    const { logout } = useAuthStore.getState();
    logout(false); // Don't show toast in tests

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  it('should update user preferences', async () => {
    const mockPreferences = { theme: 'dark', language: 'en' };

    useAuthStore.setState({
      user: {
        id: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin',
      } as any,
    });

    vi.mocked(require('../../services/users.service').usersService.updateUserPreferences)
      .mockResolvedValue(mockPreferences);

    const { updatePreferences } = useAuthStore.getState();
    await updatePreferences(mockPreferences as any);

    const state = useAuthStore.getState();
    expect(state.user?.preferences).toEqual(mockPreferences);
  });
});
