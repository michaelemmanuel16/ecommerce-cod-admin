/**
 * Resolve the public base URL of the backend API. Used to build customer-facing
 * links (digital download, unsubscribe) that must point at the API host, not the
 * SPA. Prefers an explicit BACKEND_URL, then derives it from FRONTEND_URL's dev
 * port, then falls back to localhost.
 */
export function getBackendUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.FRONTEND_URL?.replace(':5173', ':3000') ||
    'http://localhost:3000'
  );
}
