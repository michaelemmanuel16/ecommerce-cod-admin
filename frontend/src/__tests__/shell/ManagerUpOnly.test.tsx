import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ManagerUpOnly } from '../../components/shell/ManagerUpOnly';
import { useAuthStore } from '../../stores/authStore';

const renderAs = (role: string | null) => {
  useAuthStore.setState({ user: role ? ({ id: 1, role } as never) : null });
  return render(
    <MemoryRouter initialEntries={['/checkout-forms/1/preview']}>
      <Routes>
        <Route path="/checkout-forms/:id/preview" element={<ManagerUpOnly><div>PREVIEW</div></ManagerUpOnly>} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('ManagerUpOnly (F-419)', () => {
  it.each(['super_admin', 'admin', 'manager'])('lets %s in', (role) => {
    renderAs(role);
    expect(screen.getByText('PREVIEW')).toBeInTheDocument();
  });

  it.each(['sales_rep', 'accountant', 'delivery_agent', 'inventory_manager'])('sends %s home', (role) => {
    renderAs(role);
    expect(screen.queryByText('PREVIEW')).toBeNull();
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });
});
