import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { adminService } from '../services/adminService';

export const getSystemConfig = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await adminService.getSystemConfig(req.user);
    res.json(config);
  } catch (error) {
    next(error);
  }
};

export const getPublicConfig = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await adminService.getPublicConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
};

export const updateSystemConfig = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await adminService.updateSystemConfig(req.user!, req.body);
    res.json(config);
  } catch (error) {
    next(error);
  }
};

export const getRolePermissions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const permissions = await adminService.getRolePermissions(req.user!);
    res.json(permissions);
  } catch (error) {
    next(error);
  }
};

export const updateRolePermissions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await adminService.updateRolePermissions(req.user!, req.body);

    // Clear permissions cache
    const { clearPermissionsCache } = await import('../middleware/auth');
    clearPermissionsCache();

    // Notify via socket
    const { getSocketInstance } = await import('../utils/socketInstance');
    const { emitPermissionsUpdated } = await import('../sockets');
    const io = getSocketInstance();

    if (io) {
      const updatedRoles = Object.keys(req.body);
      emitPermissionsUpdated(io, updatedRoles);
    }

    res.json(config.rolePermissions);
  } catch (error) {
    next(error);
  }
};

export const getAllUsers = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const role = req.query.role as any;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const result = await adminService.getAllUsers(req.user!, page, limit, role, isActive);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const createUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await adminService.createUser(req.user!, req.body);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);
    const user = await adminService.updateUser(req.user!, userId, req.body);
    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const resetUserPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);
    const { password } = req.body;

    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    await adminService.resetUserPassword(req.user!, userId, password);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent self-deactivation (can still be handled in service, but good to have here too)
    if (userId === req.user?.id) {
      res.status(403).json({ error: 'Cannot deactivate your own account' });
      return;
    }

    await adminService.deleteUser(req.user!, userId);
    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    next(error);
  }
};

export const permanentlyDeleteUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);

    if (userId === req.user?.id) {
      res.status(403).json({ error: 'Cannot delete your own account' });
      return;
    }

    await adminService.permanentlyDeleteUser(req.user!, userId);
    res.json({ message: 'User permanently deleted' });
  } catch (error) {
    next(error);
  }
};
