import React from 'react';
import { User, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useNavigate } from 'react-router-dom';
import { Dropdown, DropdownItem } from '../ui/Dropdown';
import { Avatar } from '../ui/Avatar';

export const UserMenu: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Dropdown
      trigger={
        <button className="flex items-center gap-2">
          <Avatar
            name={user ? `${user.firstName} ${user.lastName}` : undefined}
            src={user?.avatar}
          />
        </button>
      }
      align="right"
    >
      <div className="px-4 py-2 border-b">
        <p className="font-semibold">
          {user ? `${user.firstName} ${user.lastName}` : 'Unknown User'}
        </p>
        <p className="text-xs text-gray-600">{user?.email}</p>
      </div>
      <DropdownItem onClick={() => navigate('/settings')}>
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </div>
      </DropdownItem>
      <DropdownItem onClick={handleLogout}>
        <div className="flex items-center gap-2 text-red-600">
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </div>
      </DropdownItem>
    </Dropdown>
  );
};
