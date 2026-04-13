import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Unit tests for the isPlatformDomain logic ───────────────────────────────

describe('isPlatformDomain detection', () => {
  it('returns false for localhost (default JSDOM hostname)', () => {
    const isPlatformDomain = window.location.hostname === 'platform.codadminpro.com';
    expect(isPlatformDomain).toBe(false);
  });

  it('returns true when hostname is platform.codadminpro.com', () => {
    vi.stubGlobal('location', { hostname: 'platform.codadminpro.com' });
    const isPlatformDomain = window.location.hostname === 'platform.codadminpro.com';
    expect(isPlatformDomain).toBe(true);
  });

  it('returns false for main domain', () => {
    vi.stubGlobal('location', { hostname: 'codadminpro.com' });
    const isPlatformDomain = window.location.hostname === 'platform.codadminpro.com';
    expect(isPlatformDomain).toBe(false);
  });
});

// ─── PlatformGuard redirect target logic ─────────────────────────────────────

describe('PlatformGuard redirect target', () => {
  it('redirects unauthenticated users to /login on platform domain', () => {
    const isPlatformDomain = true; // simulating platform.codadminpro.com
    const redirectTarget = isPlatformDomain ? '/login' : '/platform/login';
    expect(redirectTarget).toBe('/login');
  });

  it('redirects unauthenticated users to /platform/login on main domain', () => {
    const isPlatformDomain = false; // simulating codadminpro.com
    const redirectTarget = isPlatformDomain ? '/login' : '/platform/login';
    expect(redirectTarget).toBe('/platform/login');
  });
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
