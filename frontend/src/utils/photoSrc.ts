import { API_URL } from '../services/tokenRefresh';

/** A stored photo path starts with `/` and is served by the API; a full URL is used as it is. */
export const photoSrc = (url: string): string => (url.startsWith('/') ? `${API_URL}${url}` : url);
