import { Navigate } from 'react-router-dom';

/** The old /webhooks page is the Webhooks tab of Connections (M9-T45). */
export function WebhooksRedirect() {
  return <Navigate to="/connections?tab=webhooks" replace />;
}
