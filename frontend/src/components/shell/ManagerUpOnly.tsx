import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { isManagerUp } from './navModel';

/** Owner, admin and manager only. Anyone else goes to their home page. Used by the checkout form preview (F-419). */
export const ManagerUpOnly: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const role = useAuthStore((s) => s.user?.role);
  return role && isManagerUp(role) ? <>{children}</> : <Navigate to="/" replace />;
};
