/** An absolute link into the app (FRONTEND_URL doubles as the public base URL). `path` starts with a slash. */
export const appUrl = (path: string): string => `${process.env.FRONTEND_URL || 'http://localhost:5173'}${path}`;
