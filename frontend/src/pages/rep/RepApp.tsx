import React from 'react';
import { useAuthStore } from '../../stores/authStore';

export const RepApp: React.FC<{ defaultTab?: string }> = ({ defaultTab = 'today' }) => {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="rep-app v2" data-tab={defaultTab}>
      <header className="bar2">
        <div className="who2">
          <b>CodAdmin</b>
          <small>Call rep · {user?.firstName} {user?.lastName}</small>
        </div>
      </header>
      <main className="content">
        <h1>Hi, {user?.firstName}</h1>
        <p>Your confirmations and your pay, in one place.</p>
      </main>
    </div>
  );
};

export default RepApp;
