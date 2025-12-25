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
    getMe: vi.fn(),
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

  it('should handle registration error', async () => {
    const mockError = new Error('Email already exists');
    vi.mocked(authService.register).mockRejectedValue(mockError);

    const { register } = useAuthStore.getState();

    await expect(
      register({
        email: 'existing@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
      })
    ).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false); // Should reset loading state
  });

  it('should set access token', () => {
    const { setAccessToken } = useAuthStore.getState();
    setAccessToken('new-token-123');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new-token-123');
  });

  it('should logout without showing toast', () => {
    useAuthStore.setState({
      user: { id: '123', email: 'test@example.com' } as any,
      accessToken: 'token_123',
      refreshToken: 'refresh_123',
      isAuthenticated: true,
    });

    vi.mocked(authService.logout).mockResolvedValue(undefined);

    const { logout } = useAuthStore.getState();
    logout(false);

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('should update user preferences', async () => {
    const mockUser = { id: '123', firstName: 'Test', lastName: 'User', email: 'test@test.com', role: 'admin' as any };
    const mockPreferences = { theme: 'dark', language: 'en', notifications: { email: true, push: false, sms: true } };

    useAuthStore.setState({ user: mockUser, isAuthenticated: true });

    // Mock usersService
    const usersService = await import('../../services/users.service');
    vi.spyOn(usersService.usersService, 'updateUserPreferences').mockResolvedValue(mockPreferences);

    const { updatePreferences } = useAuthStore.getState();
    await updatePreferences(mockPreferences);

    const state = useAuthStore.getState();
    expect(state.user?.preferences).toEqual(mockPreferences);
  });

  it('should handle updatePreferences error', async () => {
    const mockUser = { id: '123', firstName: 'Test', lastName: 'User', email: 'test@test.com', role: 'admin' as any };
    const mockPreferences = { theme: 'dark', language: 'en', notifications: { email: true, push: false, sms: true } };

    useAuthStore.setState({ user: mockUser, isAuthenticated: true });

    const usersService = await import('../../services/users.service');
    vi.spyOn(usersService.usersService, 'updateUserPreferences').mockRejectedValue(new Error('Update failed'));

    const { updatePreferences } = useAuthStore.getState();
    await expect(updatePreferences(mockPreferences)).rejects.toThrow('Update failed');
  });

  it('should refresh permissions when authenticated', async () => {
    const mockUser = { id: '123', firstName: 'Test', lastName: 'User', email: 'test@test.com', role: 'admin' as any };
    const mockPermissions = { admin: { users: { create: true, read: true, update: true, delete: true } } };

    useAuthStore.setState({ user: mockUser, isAuthenticated: true });

    vi.mocked(authService.getMe).mockResolvedValue({ user: mockUser, permissions: mockPermissions } as any);

    const { refreshPermissions } = useAuthStore.getState();
    await refreshPermissions();

    const state = useAuthStore.getState();
    expect(state.permissions).toEqual(mockPermissions);
  });

  it('should not refresh permissions when not authenticated', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });

    const { refreshPermissions } = useAuthStore.getState();
    await refreshPermissions();

    expect(authService.getMe).not.toHaveBeenCalled();
  });

  // Note: setupPermissionListener requires socket mocking - covered in E2E tests
});
