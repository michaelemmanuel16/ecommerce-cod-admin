import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { features } from '../../config/features';

/** A page that exists only while SaaS signup is on (F-123). With the flag off it redirects to /login. */
export function SaasRoute({ children }: { children: ReactNode }) {
  return features.saasSignup ? <>{children}</> : <Navigate to="/login" replace />;
}
