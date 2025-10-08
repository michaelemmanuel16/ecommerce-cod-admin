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
      token: null,
      refreshToken: null,
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it('should initialize with null user and token', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
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
        access_token: 'access_token_123',
        refresh_token: 'refresh_token_123',
      },
    };

    vi.mocked(authService.login).mockResolvedValue(mockResponse);

    const { login } = useAuthStore.getState();
    await login('test@example.com', 'password123');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockResponse.user);
    expect(state.token).toBe('access_token_123');
    expect(state.refreshToken).toBe('refresh_token_123');
    expect(state.isLoading).toBe(false);
  });

  it('should handle login error', async () => {
    const mockError = {
      response: {
        data: {
          message: 'Invalid credentials',
        },
      },
    };

    vi.mocked(authService.login).mockRejectedValue(mockError);

    const { login } = useAuthStore.getState();

    await expect(
      login('test@example.com', 'wrongpassword')
    ).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.error).toBe('Invalid credentials');
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
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
      },
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
    expect(state.token).toBe('new_access_token');
  });

  it('should clear user data on logout', () => {
    // Set initial state
    useAuthStore.setState({
      user: { id: '123', email: 'test@example.com' } as any,
      token: 'token_123',
      refreshToken: 'refresh_123',
    });

    vi.mocked(authService.logout).mockResolvedValue(undefined);

    const { logout } = useAuthStore.getState();
    logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  it('should update user data', () => {
    useAuthStore.setState({
      user: {
        id: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
      } as any,
    });

    const { updateUser } = useAuthStore.getState();
    updateUser({ firstName: 'Updated' });

    const state = useAuthStore.getState();
    expect(state.user?.firstName).toBe('Updated');
  });

  it('should check auth and update user', async () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'admin',
    };

    useAuthStore.setState({ token: 'valid_token' });
    vi.mocked(authService.getCurrentUser).mockResolvedValue(mockUser as any);

    const { checkAuth } = useAuthStore.getState();
    await checkAuth();

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
  });

  it('should clear auth on checkAuth failure', async () => {
    useAuthStore.setState({
      token: 'invalid_token',
      user: { id: '123' } as any,
    });

    vi.mocked(authService.getCurrentUser).mockRejectedValue(new Error('Unauthorized'));

    const { checkAuth } = useAuthStore.getState();
    await checkAuth();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
  });
});
