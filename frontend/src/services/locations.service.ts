import apiClient from './api';

// Towns change rarely: keep each state's list for the life of the page.
const cache = new Map<string, Promise<string[]>>();

export const locationsService = {
  /** Towns of one state in the store's country. */
  getTowns(state: string): Promise<string[]> {
    const hit = cache.get(state);
    if (hit) return hit;
    const request = apiClient
      .get('/api/locations/towns', { params: { state } })
      .then((res) => (res.data.towns ?? []) as string[])
      .catch((err) => {
        cache.delete(state);
        throw err;
      });
    cache.set(state, request);
    return request;
  },
};
