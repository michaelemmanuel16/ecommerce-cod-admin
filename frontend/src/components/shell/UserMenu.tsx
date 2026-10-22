import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { photoSrc } from '../../utils/photoSrc';
import { platformLoginPath } from '../../utils/platformDomain';
import { usePopover } from './usePopover';

const initials = (first = '', last = '') => `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();

/** The avatar and its menu (F-104): Profile, Security, Sign out. Profile and Security open those Settings tabs. */
export function UserMenu() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const roles = useAuthStore((s) => s.roles);
  const { open, toggle, close, wrapRef, triggerRef } = usePopover();

  const signOut = () => {
    close();
    const toPlatform = user?.isPlatformAdmin;
    // logout() clears the tokens and sends POST /api/auth/logout; a failed request does not block it.
    useAuthStore.getState().logout();
    useConfigStore.getState().reset();
    navigate(toPlatform ? platformLoginPath() : '/login');
  };

  return (
    <div className="popwrap" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="avatar"
        onClick={toggle}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user?.photoUrl ? <img src={photoSrc(user.photoUrl)} alt="" className="avatar-img" /> : initials(user?.firstName, user?.lastName)}
      </button>
      {open && (
        <div className="sx-menu" role="menu">
          <div className="sx-who">
            <b>{user ? `${user.firstName} ${user.lastName}` : ''}</b>
            <small>{roles?.map((r) => r.name).join(' · ')}</small>
          </div>
          <Link to="/settings?tab=profile" role="menuitem" onClick={close}>Profile</Link>
          <Link to="/settings?tab=security" role="menuitem" onClick={close}>Security</Link>
          <button type="button" role="menuitem" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}
