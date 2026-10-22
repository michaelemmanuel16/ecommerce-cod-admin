import axios from 'axios';

/** A refused request carries its own plain sentence (`error`, else `message`); anything else gets the fallback. */
export const apiErrorMessage = (e: unknown, fallback: string): string =>
  (axios.isAxiosError(e) && (e.response?.data?.error || e.response?.data?.message)) || fallback;
