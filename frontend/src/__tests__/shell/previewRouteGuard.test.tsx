import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AccessGate } from '../../components/shell/AccessGate';
import { useAuthStore } from '../../stores/authStore';

// The preview route sits outside the shell and is guarded like the forms list: AccessGate checking /checkout-forms (F-419).
const MENU = {
  super_admin: ['checkoutForms'],
  manager: ['checkoutForms'],
  sales_rep: ['orders'],
  accountant: ['finance'],
};

const renderAs = (role: keyof typeof MENU) => {
  useAuthStore.setState({
    user: { id: 1, role, firstName: 'T', lastName: 'U', isPlatformAdmin: false } as never,
    menu: MENU[role],
    homeRoute: '/',
    isAuthenticated: true,
  });
  return render(
    <MemoryRouter initialEntries={['/checkout-forms/1/preview']}>
      <Routes>
        <Route element={<AccessGate as="/checkout-forms" />}>
          <Route path="/checkout-forms/:id/preview" element={<div>PREVIEW</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
};

describe('checkout form preview route guard (F-419)', () => {
  it.each(['super_admin', 'manager'] as const)('lets %s in', (role) => {
    renderAs(role);
    expect(screen.getByText('PREVIEW')).toBeInTheDocument();
  });

  it.each(['sales_rep', 'accountant'] as const)('shows no access to %s', (role) => {
    renderAs(role);
    expect(screen.queryByText('PREVIEW')).toBeNull();
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
  });
});
