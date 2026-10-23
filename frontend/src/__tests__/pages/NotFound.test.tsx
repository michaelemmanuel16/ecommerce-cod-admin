import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFound } from '../../pages/NotFound';
import { useAuthStore } from '../../stores/authStore';

const appRoute = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('../../config/features', () => ({ roleAppRoute: () => appRoute.value }));

const person = (role: string, extra: object = {}) => ({ id: 1, email: 'a@b.c', firstName: 'A', lastName: 'B', role, createdAt: '', updatedAt: '', ...extra }) as never;

beforeEach(() => {
  appRoute.value = null;
});

function renderPage() {
  return render(<MemoryRouter><NotFound /></MemoryRouter>);
}

describe('404 page (F-109)', () => {
  it('owner: link goes to the dashboard', () => {
    useAuthStore.setState({ user: person('super_admin'), homeRoute: '/' });
    renderPage();
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your home page' })).toHaveAttribute('href', '/');
  });

  it('finance clerk: link goes to /finance', () => {
    useAuthStore.setState({ user: person('accountant'), homeRoute: '/finance' });
    renderPage();
    expect(screen.getByRole('link', { name: 'Go to your home page' })).toHaveAttribute('href', '/finance');
  });

  it('platform admin: link goes to /platform', () => {
    useAuthStore.setState({ user: person('super_admin', { isPlatformAdmin: true }), homeRoute: '/' });
    renderPage();
    expect(screen.getByRole('link', { name: 'Go to your home page' })).toHaveAttribute('href', '/platform');
  });

  it('a role with its own app (flag on): link goes to the app', () => {
    appRoute.value = '/rep';
    useAuthStore.setState({ user: person('sales_rep'), homeRoute: '/orders' });
    renderPage();
    expect(screen.getByRole('link', { name: 'Go to your home page' })).toHaveAttribute('href', '/rep');
  });
});
