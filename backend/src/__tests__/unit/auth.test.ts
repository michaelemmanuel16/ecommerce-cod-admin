import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import bcrypt from 'bcrypt';
import { login, register, refresh, logout } from '../../controllers/authController';
import { prismaMock } from '../mocks/prisma.mock';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt';

// Mock dependencies
jest.mock('../../utils/jwt');
jest.mock('bcrypt');

describe('Auth Controller', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockReq = {
      body: {},
      user: null,
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
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

      await login(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Login successful',
          accessToken: 'access_token',
          refreshToken: 'refresh_token',
        })
      );
    });

    it('should reject login with invalid credentials', async () => {
      mockReq.body = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(login(mockReq, mockRes)).rejects.toThrow();
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

      await expect(login(mockReq, mockRes)).rejects.toThrow('Account is deactivated');
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

      await register(mockReq, mockRes);

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

      await expect(register(mockReq, mockRes)).rejects.toThrow('User already exists');
    });
  });

  describe('refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        role: 'admin',
        refreshToken: 'valid_refresh_token',
      };

      mockReq.body = {
        refreshToken: 'valid_refresh_token',
      };

      jest.requireMock('../../utils/jwt').verifyRefreshToken.mockReturnValue({
        id: '123',
        email: 'test@example.com',
        role: 'admin',
      });

      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      (generateAccessToken as jest.Mock).mockReturnValue('new_access_token');

      await refresh(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        accessToken: 'new_access_token',
      });
    });
  });

  describe('logout', () => {
    it('should logout user successfully', async () => {
      mockReq.user = { id: '123' };

      prismaMock.user.update.mockResolvedValue({} as any);

      await logout(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Logout successful',
      });
    });
  });
});
