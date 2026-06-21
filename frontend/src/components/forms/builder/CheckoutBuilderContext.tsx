import React from 'react';
import { CheckoutBuilderContext, CheckoutBuilderContextValue } from './checkoutBuilderContextValue';

export const CheckoutBuilderProvider: React.FC<{
  value: CheckoutBuilderContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <CheckoutBuilderContext.Provider value={value}>{children}</CheckoutBuilderContext.Provider>
);
