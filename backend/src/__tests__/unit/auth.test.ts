import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock dependencies BEFORE any other imports
jest.mock('../../utils/jwt');
jest.mock('bcrypt');
jest.mock('../../services/adminService', () => ({
  adminService: {
    getRolePermissions: jest.fn()
  }
}));

// Import prismaMock first to activate the jest.mock in prisma.mock.ts
import { prismaMock } from '../mocks/prisma.mock';

// Now import other dependencies
import bcrypt from 'bcrypt';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt';
import { login, register, refresh, logout } from '../../controllers/authController';
import { adminService } from '../../services/adminService';

describe('Auth Controller', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = {
      body: {},
      user: null,
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();

    // Setup adminService mock
    (adminService.getRolePermissions as jest.Mock).mockResolvedValue({
      admin: { users: { create: true, read: true, update: true, delete: true } },
      customer_rep: { orders: { create: true, read: true } },
      sales_rep: { orders: { create: true, read: true } }
    });
  });

  describe('login', () => {
    it('should login user with valid credentials', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        password: 'hashedPassword',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin' as any,
        isActive: true,
      };

      mockReq.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (generateAccessToken as jest.Mock).mockReturnValue('access_token');
      (generateRefreshToken as jest.Mock).mockReturnValue('refresh_token');
      prismaMock.user.update.mockResolvedValue(mockUser as any);

      await login(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Login successful',
          tokens: expect.objectContaining({
            accessToken: 'access_token',
            refreshToken: 'refresh_token',
          })
        })
      );
    });

    it('should reject login with invalid credentials', async () => {
      mockReq.body = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      prismaMock.user.findUnique.mockResolvedValue(null);

      await login(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should reject login for inactive user', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        password: 'hashedPassword',
        isActive: false,
      };

      mockReq.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);

      await login(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Account is deactivated' })
      );
    });
  });

  describe('register', () => {
    it('should register a new user', async () => {
      mockReq.body = {
        email: 'newuser@example.com',
        password: 'password123',
        firstName: 'New',
        lastName: 'User',
        role: 'customer_rep',
      };

      prismaMock.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      prismaMock.user.create.mockResolvedValue({
        id: '456',
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'User',
        role: 'customer_rep',
        createdAt: new Date(),
      } as any);

      await register(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'User registered successfully',
        })
      );
    });

    it('should reject registration with existing email', async () => {
      mockReq.body = {
        email: 'existing@example.com',
        password: 'password123',
      };

      prismaMock.user.findUnique.mockResolvedValue({ id: '123' } as any);

      await register(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User already exists' })
      );
    });
  });

  describe('refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const mockUser = {
        id: 123,
        email: 'test@example.com',
        role: 'admin' as any,
        refreshToken: 'valid_refresh_token',
      };

      mockReq.body = {
        refreshToken: 'valid_refresh_token',
      };

      // Import verifyRefreshToken and mock it
      const { verifyRefreshToken } = await import('../../utils/jwt');
      (verifyRefreshToken as jest.Mock).mockReturnValue({
        id: 123,  // Must be a number, not string
        email: 'test@example.com',
        role: 'admin',
      });

      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      (generateAccessToken as jest.Mock).mockReturnValue('new_access_token');

      await refresh(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        accessToken: 'new_access_token',
      });
    });
  });

  describe('logout', () => {
    it('should logout user successfully', async () => {
      mockReq.user = { id: '123' };

      prismaMock.user.update.mockResolvedValue({} as any);

      await logout(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Logout successful',
      });
    });
  });
});
