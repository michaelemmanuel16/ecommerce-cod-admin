import axios from 'axios';
import { normalizeResponses } from './money';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Money arrives as strings; parse once at the edge
normalizeResponses(api);

export default api;
