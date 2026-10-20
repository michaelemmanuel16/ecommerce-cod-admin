import axios from 'axios';
import { normalizeMoney } from './money';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Money arrives as strings; parse once at the edge
api.interceptors.response.use((response) => {
  normalizeMoney(response.data);
  return response;
});

export default api;
