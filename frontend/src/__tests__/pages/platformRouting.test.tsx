import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Platform domain router tree — route isolation ───────────────────────────

// Simulates the platform domain router tree (what App renders when isPlatformDomain=true)
const PlatformRouterTree: React.FC = () => (
  <Routes>
    <Route path="/login" element={<div>Platform Login</div>} />
    <Route path="/" element={<div>Platform Dashboard</div>} />
    <Route path="/tenants" element={<div>Platform Tenants</div>} />
    <Route path="/tenants/:id" element={<div>Platform Tenant Detail</div>} />
    <Route path="/announcements" element={<div>Platform Announcements</div>} />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes>
);

// Simulates the tenant domain router tree (what App renders when isPlatformDomain=false)
const TenantRouterTree: React.FC = () => (
  <Routes>
    <Route path="/login" element={<div>Tenant Login</div>} />
    <Route path="/platform/login" element={<div>Platform Login (old path)</div>} />
    <Route path="/orders" element={<div>Orders</div>} />
    <Route path="/" element={<div>Tenant Dashboard</div>} />
  </Routes>
);

describe('Platform domain router tree', () => {
  it('serves /login as platform login on platform domain', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <PlatformRouterTree />
      </MemoryRouter>
    );
    expect(screen.getByText('Platform Login')).toBeTruthy();
  });

  it('redirects unknown paths to /login on platform domain', () => {
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <PlatformRouterTree />
      </MemoryRouter>
    );
    // /orders doesn't exist in platform tree, redirects to /login
    expect(screen.getByText('Platform Login')).toBeTruthy();
  });

  it('serves /tenants on platform domain', () => {
    render(
      <MemoryRouter initialEntries={['/tenants']}>
        <PlatformRouterTree />
      </MemoryRouter>
    );
    expect(screen.getByText('Platform Tenants')).toBeTruthy();
  });
});

describe('Tenant domain router tree', () => {
  it('serves /login as tenant login on main domain', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <TenantRouterTree />
      </MemoryRouter>
    );
    expect(screen.getByText('Tenant Login')).toBeTruthy();
  });

  it('serves /platform/login on main domain (before nginx redirect kicks in)', () => {
    render(
      <MemoryRouter initialEntries={['/platform/login']}>
        <TenantRouterTree />
      </MemoryRouter>
    );
    expect(screen.getByText('Platform Login (old path)')).toBeTruthy();
  });
});
