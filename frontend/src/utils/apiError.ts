import axios from 'axios';

/** A refused request carries its own plain sentence (`error`, also as `error.message`, else `message`); anything else gets the fallback. */
export const apiErrorMessage = (e: unknown, fallback: string): string => {
  if (!axios.isAxiosError(e)) return fallback;
  const data = e.response?.data;
  const error = typeof data?.error === 'string' ? data.error : data?.error?.message;
  return error || data?.message || fallback;
};
