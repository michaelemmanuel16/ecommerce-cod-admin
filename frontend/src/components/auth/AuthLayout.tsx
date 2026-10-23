import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Centred card for Login, Forgot password and Reset password (F-120, F-121). Tokens and base components only. */
export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="v2 authpage">
      <main className="authbox">
        <div className="brand">
          <div className="logo"><Zap aria-hidden="true" /></div>
          <b>CodAdmin</b>
        </div>
        <div className="card authcard">
          <h1>{title}</h1>
          {subtitle && <p className="authsub">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
