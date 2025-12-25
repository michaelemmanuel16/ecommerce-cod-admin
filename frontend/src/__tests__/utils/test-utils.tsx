/* eslint-disable react-refresh/only-export-components */
import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// Custom render function that includes providers
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return <BrowserRouter>{children}</BrowserRouter>;
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };

// Mock data helpers
export const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  role: 'admin' as const,
  phoneNumber: '+1234567890',
  isActive: true,
  isAvailable: true,
  createdAt: new Date().toISOString(),
};

export const mockOrder = {
  id: 'order-123',
  orderNumber: 'ORD-001',
  status: 'pending_confirmation' as const,
  customerId: 'customer-123',
  customer: {
    id: 'customer-123',
    firstName: 'John',
    lastName: 'Doe',
    phoneNumber: '+1234567890',
    email: 'john@example.com',
  },
  orderItems: [
    {
      id: 'item-1',
      productId: 'product-1',
      quantity: 2,
      unitPrice: 50,
      totalPrice: 100,
      product: {
        id: 'product-1',
        name: 'Test Product',
        sku: 'TEST-001',
      },
    },
  ],
  subtotal: 100,
  shippingCost: 10,
  discount: 0,
  totalAmount: 110,
  codAmount: 110,
  deliveryAddress: '123 Test St',
  deliveryCity: 'New York',
  deliveryState: 'NY',
  deliveryZipCode: '10001',
  deliveryArea: 'Manhattan',
  priority: 'medium' as const,
  source: 'manual' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const mockProduct = {
  id: 'product-1',
  name: 'Test Product',
  sku: 'TEST-001',
  description: 'A test product',
  category: 'Electronics',
  price: 50,
  costPrice: 30,
  stockQuantity: 100,
  lowStockThreshold: 10,
  isActive: true,
  images: [],
  variants: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
