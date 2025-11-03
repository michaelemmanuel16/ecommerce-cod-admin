import apiClient from './api';
import { Product } from '../types';

export const productsService = {
  async getProducts(): Promise<Product[]> {
    const response = await apiClient.get('/api/products');
    return response.data.products || [];
  },

  async getProductById(id: number): Promise<Product> {
    const response = await apiClient.get(`/api/products/${id}`);
    return response.data.product || response.data;
  },

  async createProduct(product: Partial<Product>): Promise<Product> {
    const response = await apiClient.post('/api/products', product);
    return response.data.product || response.data;
  },

  async updateProduct(id: number, product: Partial<Product>): Promise<Product> {
    const response = await apiClient.put(`/api/products/${id}`, product);
    return response.data.product || response.data;
  },

  async deleteProduct(id: number): Promise<void> {
    await apiClient.delete(`/api/products/${id}`);
  },
};
