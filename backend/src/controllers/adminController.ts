import { Response } from 'express';
import { AuthRequest } from '../types';
import { adminService } from '../services/adminService';

export const getSystemConfig = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await adminService.getSystemConfig();
    res.json(config);
  } catch (error) {
    console.error('Error fetching system config:', error);
    res.status(500).json({ error: 'Failed to fetch system configuration' });
  }
};

export const updateSystemConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await adminService.updateSystemConfig(req.body);
    res.json(config);
  } catch (error) {
    console.error('Error updating system config:', error);
    res.status(500).json({ error: 'Failed to update system configuration' });
  }
};

export const getRolePermissions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const permissions = await adminService.getRolePermissions();
    res.json(permissions);
  } catch (error) {
    console.error('Error fetching role permissions:', error);
    res.status(500).json({ error: 'Failed to fetch role permissions' });
  }
};

export const updateRolePermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await adminService.updateRolePermissions(req.body);

    // Clear permissions cache so new permissions take effect immediately
    const { clearPermissionsCache } = await import('../middleware/auth');
    clearPermissionsCache();

    // Emit socket event to notify all connected users about permission changes
    const { getSocketInstance } = await import('../utils/socketInstance');
    const { emitPermissionsUpdated } = await import('../sockets');
    const io = getSocketInstance();

    if (io) {
      // Get all roles that were updated
      const updatedRoles = Object.keys(req.body);
      emitPermissionsUpdated(io, updatedRoles);
    }

    res.json(config.rolePermissions);
  } catch (error) {
    console.error('Error updating role permissions:', error);
    res.status(500).json({ error: 'Failed to update role permissions' });
  }
};

export const getAllUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const role = req.query.role as any;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const result = await adminService.getAllUsers(page, limit, role, isActive);
    res.json(result);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await adminService.createUser(req.body);
    res.status(201).json(user);
  } catch (error: any) {
    console.error('Error creating user:', error);
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'User with this email already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent non-super-admins from editing super_admin users
    if (req.user?.role !== 'super_admin') {
      const targetUser = await adminService.getAllUsers(1, 1, undefined, undefined);
      const user = targetUser.users.find(u => u.id === userId);
      if (user?.role === 'super_admin') {
        res.status(403).json({ error: 'Cannot edit super admin users' });
        return;
      }
    }

    const user = await adminService.updateUser(userId, req.body);
    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

export const resetUserPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);
    const { password } = req.body;

    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    await adminService.resetUserPassword(userId, password);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent deleting super_admin users
    const targetUser = await adminService.getAllUsers(1, 1, undefined, undefined);
    const user = targetUser.users.find(u => u.id === userId);
    if (user?.role === 'super_admin') {
      res.status(403).json({ error: 'Cannot delete super admin users' });
      return;
    }

    // Prevent self-deletion
    if (userId === req.user?.id) {
      res.status(403).json({ error: 'Cannot delete your own account' });
      return;
    }

    await adminService.deleteUser(userId);
    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

export const permanentlyDeleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent deleting super_admin users
    const targetUser = await adminService.getAllUsers(1, 1, undefined, undefined);
    const user = targetUser.users.find(u => u.id === userId);
    if (user?.role === 'super_admin') {
      res.status(403).json({ error: 'Cannot delete super admin users' });
      return;
    }

    // Prevent self-deletion
    if (userId === req.user?.id) {
      res.status(403).json({ error: 'Cannot delete your own account' });
      return;
    }

    await adminService.permanentlyDeleteUser(userId);
    res.json({ message: 'User permanently deleted' });
  } catch (error) {
    console.error('Error permanently deleting user:', error);
    res.status(500).json({ error: 'Failed to permanently delete user' });
  }
};
