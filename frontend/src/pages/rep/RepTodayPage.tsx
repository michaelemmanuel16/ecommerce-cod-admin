import React from 'react';
import { useAuthStore } from '../../stores/authStore';

export const RepTodayPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="rep-today-view" data-testid="rep-today-page">
      <div className="head">
        <div>
          <h1>Hi, {user?.firstName ?? 'there'}</h1>
          <p>Your confirmations and your pay, in one place.</p>
        </div>
      </div>
    </div>
  );
};

export default RepTodayPage;
