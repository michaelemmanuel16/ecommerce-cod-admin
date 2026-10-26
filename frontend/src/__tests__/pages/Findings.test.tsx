import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Findings } from '../../pages/financial/Findings';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import type { Finding } from '../../services/findings.service';

const svc = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), assignees: vi.fn() }));
vi.mock('../../services/findings.service', async (orig) => ({
  ...(await orig<typeof import('../../services/findings.service')>()),
  findingsService: { list: svc.list, update: svc.update },
  findingAssignees: svc.assignees,
}));
let role = 'super_admin';
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true, user: { role } }) }));

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 1, type: 'short_pay', status: 'open', subjectType: 'partner_settlement', subjectId: '9', amount: 840, note: 'Logiswift paid GH₵840 less than its list.',
  explanation: null, assigneeId: null, assignee: null, resolvedById: null, resolvedAt: null, createdAt: '2026-10-11T10:00:00Z', ...over,
});
const page = (findings: Finding[]) => ({ findings, pagination: { page: 1, limit: 25, total: findings.length, pages: 1 } });
const open = (url = '/finance/findings') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><Findings /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  role = 'super_admin';
  useConfigStore.setState({ currency: 'GHS' });
  svc.list.mockResolvedValue(page([finding()]));
  svc.assignees.mockResolvedValue([{ id: 3, name: 'Adwoa Darko' }]);
  svc.update.mockResolvedValue(finding({ status: 'explained' }));
});

describe('Findings page (M5-T35, F-909)', () => {
  it('lists open Findings by default with type, amount and status', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Findings' });
    expect(table).toHaveTextContent('Short payment');
    expect(table).toHaveTextContent('GH₵840');
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'open', page: 1 }));
  });

  it('filters by type, status and assignee', async () => {
    open();
    await screen.findByRole('table', { name: 'Findings' });
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'cash_gap');
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'cash_gap', status: 'open' })));
    await userEvent.selectOptions(screen.getByLabelText('Assigned to'), 'none');
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ assigneeId: 'none' })));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'all');
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined })));
  });

  it('explains a Finding with a required note', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve Short payment' }));
    const explain = screen.getByRole('button', { name: 'Mark explained' });
    expect(explain).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Note'), 'Logiswift sent the rest on 14 Oct');
    await userEvent.click(explain);
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(1, { status: 'explained', explanation: 'Logiswift sent the rest on 14 Oct' }));
  });

  it('assigns a Finding without a note', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve Short payment' }));
    await userEvent.selectOptions(within(screen.getByRole('dialog')).getByLabelText('Assigned to'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(1, { assigneeId: 3 }));
  });

  it('write-off asks first and sends written_off; it is disabled with the reason for a non-owner', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve Short payment' }));
    await userEvent.type(screen.getByLabelText('Note'), 'Agreed loss');
    await userEvent.click(screen.getByRole('button', { name: 'Write off' }));
    expect(screen.getByText('Write off this Finding?')).toBeInTheDocument();
    expect(svc.update).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole('button', { name: 'Write off' }).at(-1)!);
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(1, { status: 'written_off', explanation: 'Agreed loss' }));
  });

  it('a non-owner sees Write off disabled', async () => {
    role = 'admin';
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve Short payment' }));
    expect(screen.getByRole('button', { name: 'Write off' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows an empty state with no open Findings, and one for filters that match nothing', async () => {
    svc.list.mockResolvedValue(page([]));
    open();
    expect(await screen.findByText('No open Findings')).toBeInTheDocument();
    open('/finance/findings?type=cash_gap');
    expect(await screen.findByText('No Findings match')).toBeInTheDocument();
  });

  it('shows an error with Try again', async () => {
    svc.list.mockRejectedValueOnce(new Error('x'));
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Findings' })).toBeInTheDocument();
  });
});
