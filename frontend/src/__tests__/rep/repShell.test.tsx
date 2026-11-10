import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RepShell } from '../../pages/rep/RepShell';
import { RepGate } from '../../App';
import { PhoneDisplay } from '../../components/rep/PhoneDisplay';
import { RepComingSoon } from '../../pages/rep/RepComingSoon';
import { QueueCallPanel } from '../../pages/rep/QueueCallPanel';
import { useAuthStore } from '../../stores/authStore';
import { repService } from '../../services/rep.service';
import { features } from '../../config/features';

vi.mock('../../components/rep/CallCard', () => ({
  CallCard: ({ orderId, onDone }: { orderId: number; onDone: (next: number | null) => void }) => (
    <button type="button" data-testid="call-card-stub" onClick={() => onDone(99)}>
      card {orderId}
    </button>
  ),
}));

vi.mock('../../services/rep.service', () => ({
  repService: {
    getSummary: vi.fn(),
  },
}));

const mockRep = {
  id: 42,
  email: 'adwoa@example.com',
  firstName: 'Adwoa',
  lastName: 'Darko',
  role: 'sales_rep' as const,
  createdAt: '',
  updatedAt: '',
};

const mockManager = {
  id: 1,
  email: 'manager@example.com',
  firstName: 'Kofi',
  lastName: 'Mensah',
  role: 'manager' as const,
  createdAt: '',
  updatedAt: '',
};

describe('M7-T14: Rep shell and navigation (F-750, F-751)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    features.repApp = true;
    vi.mocked(repService.getSummary).mockResolvedValue({
      queue: 9,
      inbox: 3,
      todayConfirmed: 19,
    });
    useAuthStore.setState({
      user: mockRep,
      isAuthenticated: true,
      accessToken: 'token',
      menu: ['orders', 'customers'],
      homeRoute: '/',
      roles: [{ id: 4, name: 'Call rep' }],
    });
  });

  describe('RepGate feature flag gate (item 1)', () => {
    it('redirects /rep/today to / when features.repApp is off and does not render rep shell', () => {
      features.repApp = false;
      render(
        <MemoryRouter initialEntries={['/rep/today']}>
          <Routes>
            <Route path="/" element={<div data-testid="home-page">Home</div>} />
            <Route
              path="/rep/*"
              element={
                <RepGate>
                  <RepShell />
                </RepGate>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.queryByTestId('rep-desktop-rail')).not.toBeInTheDocument();
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });

    it('redirects manager from /rep/today to / when features.repApp is off', () => {
      features.repApp = false;
      useAuthStore.setState({ user: mockManager });
      render(
        <MemoryRouter initialEntries={['/rep/today']}>
          <Routes>
            <Route path="/" element={<div data-testid="home-page">Home</div>} />
            <Route
              path="/rep/*"
              element={
                <RepGate>
                  <RepShell />
                </RepGate>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.queryByTestId('rep-desktop-rail')).not.toBeInTheDocument();
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });

    it('renders rep shell when features.repApp is on and user is sales_rep', () => {
      features.repApp = true;
      render(
        <MemoryRouter initialEntries={['/rep/today']}>
          <Routes>
            <Route path="/" element={<div data-testid="home-page">Home</div>} />
            <Route
              path="/rep/*"
              element={
                <RepGate>
                  <RepShell />
                </RepGate>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('rep-desktop-rail')).toBeInTheDocument();
    });
  });

  describe('Desktop rail and phone tabs navigation', () => {
    it('renders desktop rail with 5 pages and queue pill count', async () => {
      render(
        <MemoryRouter initialEntries={['/rep/today']}>
          <RepShell />
        </MemoryRouter>
      );

      const rail = screen.getByTestId('rep-desktop-rail');
      expect(rail).toBeInTheDocument();
      expect(rail).toHaveAttribute('aria-label', 'Main');

      // Check all 5 nav links on desktop rail
      expect(rail).toHaveTextContent('Today');
      expect(rail).toHaveTextContent('Queue');
      expect(rail).toHaveTextContent('My orders');
      expect(rail).toHaveTextContent('Earnings');
      expect(rail).toHaveTextContent('My numbers');

      // Check queue badge count from summary
      await waitFor(() => {
        const queuePill = screen.getByTestId('queue-pill');
        expect(queuePill).toHaveTextContent('9');
      });
    });

    it('renders phone bottom tabs with 5 pages and queue pill count', async () => {
      render(
        <MemoryRouter initialEntries={['/rep/today']}>
          <RepShell />
        </MemoryRouter>
      );

      const phoneTabs = screen.getByTestId('rep-phone-tabs');
      expect(phoneTabs).toBeInTheDocument();
      expect(phoneTabs).toHaveAttribute('aria-label', 'Pages');

      expect(phoneTabs).toHaveTextContent('Today');
      expect(phoneTabs).toHaveTextContent('Queue');
      expect(phoneTabs).toHaveTextContent('Orders');
      expect(phoneTabs).toHaveTextContent('Earnings');
      expect(phoneTabs).toHaveTextContent('Numbers');

      await waitFor(() => {
        const phonePill = screen.getByTestId('phone-queue-pill');
        expect(phonePill).toHaveTextContent('9');
      });
    });

    it('renders topbar with branding, rep name, theme toggle, and inbox bell with badge', async () => {
      render(
        <MemoryRouter initialEntries={['/rep/today']}>
          <RepShell />
        </MemoryRouter>
      );

      const topbar = screen.getByTestId('rep-topbar');
      expect(topbar).toBeInTheDocument();
      expect(topbar).toHaveTextContent('CodAdmin');
      expect(topbar).toHaveTextContent('Call rep · Adwoa Darko');

      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('rep-inbox-bell')).toHaveAttribute('href', '/rep/inbox');

      await waitFor(() => {
        const inboxBadge = screen.getByTestId('rep-inbox-badge');
        expect(inboxBadge).toHaveTextContent('3');
      });
    });

    it('does NOT show "Back to CodAdmin" for sales_rep', () => {
      useAuthStore.setState({ user: mockRep });
      render(
        <MemoryRouter initialEntries={['/rep/today']}>
          <RepShell />
        </MemoryRouter>
      );

      expect(screen.queryByTestId('back-to-codadmin')).not.toBeInTheDocument();
    });

    it('shows "Back to CodAdmin" link for manager or owner', () => {
      useAuthStore.setState({ user: mockManager });
      render(
        <MemoryRouter initialEntries={['/rep/today']}>
          <RepShell />
        </MemoryRouter>
      );

      const backLink = screen.getByTestId('back-to-codadmin');
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/');
    });
  });

  describe('Basic phone support (F-751) and "Check number" tag', () => {
    it('shows raw phone number as typed, normalizes for tel and whatsapp links, and provides no warning tag for valid number', () => {
      render(<PhoneDisplay phone="0245550103" />);

      const numberSpan = screen.getByTestId('phone-number');
      expect(numberSpan).toHaveTextContent('0245550103');

      // Valid number should have tap-to-call link
      const callLink = screen.getByTestId('tel-call-link');
      expect(callLink).toHaveAttribute('href', 'tel:+233245550103');

      // Valid number should have WhatsApp link
      const waLink = screen.getByTestId('whatsapp-link');
      expect(waLink).toHaveAttribute('href', 'https://wa.me/233245550103');

      // No "Check number" tag
      expect(screen.queryByTestId('check-number-tag')).not.toBeInTheDocument();
    });

    it('shows already-international phone number as typed and normalizes links', () => {
      render(<PhoneDisplay phone="+233245550103" />);

      const numberSpan = screen.getByTestId('phone-number');
      expect(numberSpan).toHaveTextContent('+233245550103');

      const callLink = screen.getByTestId('tel-call-link');
      expect(callLink).toHaveAttribute('href', 'tel:+233245550103');
      expect(screen.queryByTestId('check-number-tag')).not.toBeInTheDocument();
    });

    it('shows invalid/unnormalizable phone as typed, shows "Check number" tag, and omits tel: link', () => {
      render(<PhoneDisplay phone="Hallo die Conny 123" />);

      const numberSpan = screen.getByTestId('phone-number');
      // Number shown as typed
      expect(numberSpan).toHaveTextContent('Hallo die Conny 123');

      // Tag "Check number" must be present
      const tag = screen.getByTestId('check-number-tag');
      expect(tag).toBeInTheDocument();
      expect(tag).toHaveTextContent('Check number');

      // No tap-to-call link when invalid
      expect(screen.queryByTestId('tel-call-link')).not.toBeInTheDocument();
      expect(screen.queryByTestId('whatsapp-link')).not.toBeInTheDocument();
    });

    it('copy button copies phone number', async () => {
      const user = userEvent.setup();
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      render(<PhoneDisplay phone="0245550103" />);
      const copyBtn = screen.getByTestId('copy-phone-btn');
      await user.click(copyBtn);

      expect(writeTextMock).toHaveBeenCalledWith('+233245550103');
    });
  });

  describe('Placeholder and integration components', () => {
    it('RepComingSoon displays "Coming in this release" empty state with title', () => {
      render(<RepComingSoon title="My orders" />);
      const el = screen.getByTestId('rep-coming-soon');
      expect(el).toHaveTextContent('My orders');
      expect(el).toHaveTextContent('Coming in this release');
    });

    it('QueueCallPanel renders the call card for the selected order and passes onDone', async () => {
      const onDone = vi.fn();
      render(<QueueCallPanel orderId={24041} onDone={onDone} />);
      expect(screen.getByTestId('call-card-stub')).toHaveTextContent('card 24041');
      await userEvent.click(screen.getByTestId('call-card-stub'));
      expect(onDone).toHaveBeenCalledWith(99);
    });
  });
});
