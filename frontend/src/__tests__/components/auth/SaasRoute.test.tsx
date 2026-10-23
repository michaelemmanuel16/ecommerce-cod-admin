import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SaasRoute } from '../../../components/auth/SaasRoute';

const flags = vi.hoisted(() => ({ saasSignup: false }));
vi.mock('../../../config/features', () => ({ features: flags }));

beforeEach(() => {
  flags.saasSignup = false;
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>LOGIN PAGE</p>} />
        <Route path="/register" element={<SaasRoute><p>REGISTER PAGE</p></SaasRoute>} />
        <Route path="/pricing" element={<SaasRoute><p>PRICING PAGE</p></SaasRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SaasRoute (F-123)', () => {
  it.each(['/register', '/pricing'])('flag off: %s redirects to /login', (path) => {
    renderAt(path);
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
  });

  it.each([['/register', 'REGISTER PAGE'], ['/pricing', 'PRICING PAGE']])('flag on: %s shows the page', (path, text) => {
    flags.saasSignup = true;
    renderAt(path);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
