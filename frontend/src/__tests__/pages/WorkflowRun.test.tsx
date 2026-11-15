import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../components/ui-v2';
import { RunDialog } from '../../pages/workflows/RunDialog';
import { BulkBar } from '../../pages/orders/BulkBar';
import { workflow } from '../fixtures/workflows';

const svc = vi.hoisted(() => ({ getWorkflows: vi.fn(), runOnOrders: vi.fn() }));
vi.mock('../../services/workflows.service', () => ({ workflowsService: svc }));
vi.mock('../../services/orders.service', () => ({ ordersService: { getTransitions: vi.fn().mockResolvedValue({ normal: [], forced: [] }) } }));

const apiError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status, data } });

const renderDialog = (props: Partial<React.ComponentProps<typeof RunDialog>> = {}) => {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  render(<ToastProvider><RunDialog onClose={onClose} onStarted={onStarted} {...props} /></ToastProvider>);
  return { onClose, onStarted };
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.getWorkflows.mockResolvedValue({ workflows: [workflow({ id: 1, name: 'Confirm SMS' }), workflow({ id: 2, name: 'Assign Ashanti' })], summary: { activeCount: 2, runsToday: 0, failuresToday: 0 } });
  svc.runOnOrders.mockResolvedValue({ queued: 3, batches: 1 });
});

describe('Run dialog (M9-T43)', () => {
  it('from the drawer or the bulk bar: lists the active workflows, runs the given orders', async () => {
    const { onClose, onStarted } = renderDialog({ orderIds: [10, 11, 12] });
    await waitFor(() => expect(svc.getWorkflows).toHaveBeenCalledWith({ isActive: true }));
    expect(screen.getByText('Runs on 3 orders.')).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Workflow'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(svc.runOnOrders).toHaveBeenCalledWith(2, [10, 11, 12], false));
    expect(await screen.findByText('Started on 3 orders')).toBeInTheDocument();
    expect(onStarted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when no workflow is on', async () => {
    svc.getWorkflows.mockResolvedValue({ workflows: [], summary: { activeCount: 0, runsToday: 0, failuresToday: 0 } });
    renderDialog({ orderIds: [10] });
    expect(await screen.findByText('Only workflows that are switched on can run.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('from a list row: the workflow is fixed and the order numbers are typed', async () => {
    renderDialog({ workflow: { id: 1, name: 'Confirm SMS' } });
    expect(svc.getWorkflows).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Order numbers'), '#24117 24118, #24117');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(svc.runOnOrders).toHaveBeenCalledWith(1, [24117, 24118], false));
  });

  it('refuses a word that is not an order number and asks for at least one', async () => {
    renderDialog({ workflow: { id: 1, name: 'Confirm SMS' } });
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter at least one order number.');
    await userEvent.type(screen.getByLabelText('Order numbers'), '#24117, abc');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByRole('alert')).toHaveTextContent('"abc" is not an order number');
    expect(svc.runOnOrders).not.toHaveBeenCalled();
  });

  it('already_ran: shows how many orders, then "Run again anyway" sends confirm: true', async () => {
    svc.runOnOrders.mockResolvedValueOnce({ warning: 'already_ran', orderIds: [10, 11] }).mockResolvedValueOnce({ queued: 3, batches: 1 });
    const { onClose } = renderDialog({ orderIds: [10, 11, 12] });
    await userEvent.click(await screen.findByRole('button', { name: 'Run' }));
    expect(await screen.findByText('2 of the 3 orders already ran this workflow. Run again anyway?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(svc.runOnOrders).toHaveBeenCalledTimes(1);
    expect(svc.runOnOrders).toHaveBeenLastCalledWith(1, [10, 11, 12], false);
    await userEvent.click(screen.getByRole('button', { name: 'Run again anyway' }));
    await waitFor(() => expect(svc.runOnOrders).toHaveBeenLastCalledWith(1, [10, 11, 12], true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows a refusal in the API words and stays open', async () => {
    svc.runOnOrders.mockRejectedValue(apiError(409, { error: 'Switch the workflow on before running it' }));
    const { onClose } = renderDialog({ orderIds: [10] });
    await userEvent.click(await screen.findByRole('button', { name: 'Run' }));
    expect(await screen.findByText('Switch the workflow on before running it')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Orders bulk bar Run button (M9-T43)', () => {
  const props = { rows: [{ id: 1, status: 'confirmed' }] as never, reps: [], agents: [], canMove: false, canAssign: false, canDelete: false, onStatus: vi.fn(), onRep: vi.fn(), onAgent: vi.fn(), onDelete: vi.fn(), onClear: vi.fn() };

  it('shows Run workflow for a person who may execute, and calls it', async () => {
    const onRun = vi.fn();
    render(<BulkBar {...props} canRun onRun={onRun} />);
    await userEvent.click(within(screen.getByRole('region', { name: 'Selected orders' })).getByRole('button', { name: 'Run workflow' }));
    expect(onRun).toHaveBeenCalled();
  });

  it('shows no Run button without the permission', () => {
    render(<BulkBar {...props} onRun={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Run workflow' })).not.toBeInTheDocument();
  });
});
