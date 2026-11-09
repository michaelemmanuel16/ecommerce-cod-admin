import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RepQueuePage } from '../../pages/rep/RepQueuePage';
import { formatWaitDuration, formatCallbackTime } from '../../pages/rep/queueHelpers';
import { repService } from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';
import { ToastProvider } from '../../components/ui-v2';

vi.mock('../../services/rep.service', () => ({
  repService: {
    getQueue: vi.fn(),
  },
}));

vi.mock('../../pages/orders/NewOrderSheet', () => ({
  NewOrderSheet: ({ open, onClose, onCreated }: any) =>
    open ? (
      <div data-testid="mock-new-order-sheet">
        <button type="button" onClick={onClose} data-testid="mock-sheet-close">Close</button>
        <button type="button" onClick={onCreated} data-testid="mock-sheet-submit">Submit</button>
      </div>
    ) : null,
}));

const mockUser = {
  id: 42,
  email: 'adwoa@example.com',
  firstName: 'Adwoa',
  lastName: 'Darko',
  role: 'sales_rep' as const,
  createdAt: '',
  updatedAt: '',
};

function renderQueue() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <RepQueuePage />
      </MemoryRouter>
    </ToastProvider>
  );
}

describe('M7-T16: Queue page (F-754, F-765)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: mockUser,
      isAuthenticated: true,
      accessToken: 'token',
    });
  });

  describe('Tab counts from API', () => {
    it('displays counts for New, Call back, Said NO, and Not reachable tabs from the API response', async () => {
      vi.mocked(repService.getQueue).mockResolvedValue({
        tabs: {
          new: 7,
          call_back: 3,
          said_no: 2,
          not_reachable: 4,
          total: 16,
        },
        orders: [],
        total: 0,
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      });

      renderQueue();

      await waitFor(() => {
        expect(screen.getByTestId('tab-count-new')).toHaveTextContent('7');
      });
      expect(screen.getByTestId('tab-count-call_back')).toHaveTextContent('3');
      expect(screen.getByTestId('tab-count-said_no')).toHaveTextContent('2');
      expect(screen.getByTestId('tab-count-not_reachable')).toHaveTextContent('4');
      expect(screen.getByTestId('queue-summary')).toHaveTextContent('16 waiting');
    });
  });

  describe('Wait timer colors at target and at alert', () => {
    it('applies normal color when waitMinutes is under target (15 min)', async () => {
      vi.mocked(repService.getQueue).mockResolvedValue({
        tabs: { new: 1, call_back: 0, said_no: 0, not_reachable: 0, total: 1 },
        orders: [
          {
            id: 101,
            status: 'pending_confirmation',
            customer: { id: 1, name: 'Ama Serwaa', phoneNumber: '0245550101', area: 'Accra' },
            area: 'Accra',
            itemsSummary: '1x Health Pack',
            totalAmount: '249.00',
            saidNo: false,
            tab: 'new',
            waitMinutes: 8, // under 15 min
            waitTimerSeverity: 'normal',
            callbackAt: null,
            callbackDue: false,
            callbackSeverity: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            priority: 0,
          },
        ],
        total: 1,
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      });

      renderQueue();

      await waitFor(() => {
        const timer = screen.getByTestId('wait-timer-101');
        expect(timer).toBeInTheDocument();
        expect(timer).not.toHaveClass('gold');
        expect(timer).not.toHaveClass('coral');
      });
    });

    it('applies amber (gold) color when waitMinutes is between target (15 min) and alert (30 min)', async () => {
      vi.mocked(repService.getQueue).mockResolvedValue({
        tabs: { new: 1, call_back: 0, said_no: 0, not_reachable: 0, total: 1 },
        orders: [
          {
            id: 102,
            status: 'pending_confirmation',
            customer: { id: 2, name: 'Kofi Mensah', phoneNumber: '0245550102', area: 'Kumasi' },
            area: 'Kumasi',
            itemsSummary: '2x Books',
            totalAmount: '449.00',
            saidNo: false,
            tab: 'new',
            waitMinutes: 18, // >= 15 and < 30
            waitTimerSeverity: 'gold',
            callbackAt: null,
            callbackDue: false,
            callbackSeverity: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            priority: 0,
          },
        ],
        total: 1,
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      });

      renderQueue();

      await waitFor(() => {
        const timer = screen.getByTestId('wait-timer-102');
        expect(timer).toHaveClass('gold');
        expect(timer).not.toHaveClass('coral');
      });
    });

    it('applies red (coral) color when waitMinutes reaches or exceeds alert (30 min)', async () => {
      vi.mocked(repService.getQueue).mockResolvedValue({
        tabs: { new: 1, call_back: 0, said_no: 0, not_reachable: 0, total: 1 },
        orders: [
          {
            id: 103,
            status: 'pending_confirmation',
            customer: { id: 3, name: 'Akua Mansa', phoneNumber: '0245550103', area: 'Tema' },
            area: 'Tema',
            itemsSummary: '1x Set',
            totalAmount: '249.00',
            saidNo: false,
            tab: 'new',
            waitMinutes: 35, // >= 30 min
            waitTimerSeverity: 'coral',
            callbackAt: null,
            callbackDue: false,
            callbackSeverity: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            priority: 0,
          },
        ],
        total: 1,
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      });

      renderQueue();

      await waitFor(() => {
        const timer = screen.getByTestId('wait-timer-103');
        expect(timer).toHaveClass('coral');
      });
    });
  });

  describe('Said NO flag', () => {
    it('displays exact flag text "Said NO - call once before cancel" on saidNo orders', async () => {
      vi.mocked(repService.getQueue).mockResolvedValue({
        tabs: { new: 0, call_back: 0, said_no: 1, not_reachable: 0, total: 1 },
        orders: [
          {
            id: 104,
            status: 'pending_confirmation',
            customer: { id: 4, name: 'Yaw Boateng', phoneNumber: '0245550104', area: 'Takoradi' },
            area: 'Takoradi',
            itemsSummary: '1x Watch',
            totalAmount: '199.00',
            saidNo: true,
            tab: 'said_no',
            waitMinutes: 10,
            waitTimerSeverity: 'normal',
            callbackAt: null,
            callbackDue: false,
            callbackSeverity: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            priority: 0,
          },
        ],
        total: 1,
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      });

      renderQueue();

      await waitFor(() => {
        const flag = screen.getByTestId('said-no-flag');
        expect(flag).toBeInTheDocument();
        expect(flag).toHaveTextContent('Said NO - call once before cancel');
      });
    });
  });

  describe('Late call-back highlight', () => {
    it('highlights due call-backs in the Call back tab', async () => {
      const pastDue = new Date(Date.now() - 15 * 60000).toISOString();
      vi.mocked(repService.getQueue).mockResolvedValue({
        tabs: { new: 0, call_back: 1, said_no: 0, not_reachable: 0, total: 1 },
        orders: [
          {
            id: 105,
            status: 'pending_confirmation',
            customer: { id: 5, name: 'Efua Appiah', phoneNumber: '0245550105', area: 'Cape Coast' },
            area: 'Cape Coast',
            itemsSummary: '1x Shoes',
            totalAmount: '350.00',
            saidNo: false,
            tab: 'call_back',
            waitMinutes: 40,
            waitTimerSeverity: 'coral',
            callbackAt: pastDue,
            callbackDue: true,
            callbackSeverity: 'coral',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            priority: 0,
          },
        ],
        total: 1,
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      });

      renderQueue();

      // Switch to Call back tab
      const cbTab = screen.getByTestId('tab-call_back');
      await userEvent.click(cbTab);

      await waitFor(() => {
        const row = screen.getByTestId('queue-item-105');
        expect(row).toHaveClass('late-callback');
      });
      expect(screen.getByTestId('callback-timer-105')).toHaveClass('coral');
      expect(screen.getByTestId('callback-timer-105')).toHaveTextContent(/Overdue/);
    });
  });

  describe('New order button', () => {
    it('opens existing NewOrderSheet with rep as owner and refreshes on created', async () => {
      vi.mocked(repService.getQueue).mockResolvedValue({
        tabs: { new: 0, call_back: 0, said_no: 0, not_reachable: 0, total: 0 },
        orders: [],
        total: 0,
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      });

      renderQueue();

      const newOrderBtn = screen.getByTestId('new-order-btn');
      await userEvent.click(newOrderBtn);

      expect(screen.getByTestId('mock-new-order-sheet')).toBeInTheDocument();

      // Submit reloads queue
      const submitBtn = screen.getByTestId('mock-sheet-submit');
      await userEvent.click(submitBtn);

      expect(repService.getQueue).toHaveBeenCalledTimes(2);
    });
  });

  describe('Helper formatting functions', () => {
    it('formats wait durations correctly', () => {
      expect(formatWaitDuration(0.5)).toBe('< 1m');
      expect(formatWaitDuration(14)).toBe('14m');
      expect(formatWaitDuration(60)).toBe('1h');
      expect(formatWaitDuration(75)).toBe('1h 15m');
    });

    it('formats callback times correctly', () => {
      const now = Date.now();
      const in25Min = new Date(now + 25 * 60000).toISOString();
      const overdue15Min = new Date(now - 15 * 60000).toISOString();

      expect(formatCallbackTime(in25Min, now)).toEqual({ text: 'In 25m', overdue: false });
      expect(formatCallbackTime(overdue15Min, now)).toEqual({ text: 'Overdue 15m', overdue: true });
    });
  });
});
