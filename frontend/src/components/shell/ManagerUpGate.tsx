import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { NoAccess } from '../../pages/NoAccess';
import { isManagerUp } from './navModel';

/**
 * Role guard for the checkout forms pages (M3b-T10, F-408): only owner, admin and manager open them.
 * It sits inside AccessGate, which still asks for the menu item; anyone else gets the same "no access" page.
 */
export function ManagerUpGate() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return isManagerUp(user.role) ? <Outlet /> : <NoAccess />;
}
