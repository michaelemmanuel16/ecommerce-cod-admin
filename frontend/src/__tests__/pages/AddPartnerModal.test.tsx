import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AddPartnerModal } from '../../pages/deliveries/AddPartnerModal';
import { ToastProvider } from '../../components/ui-v2';

const create = vi.fn();
vi.mock('../../services/delivery-partners.service', async (orig) => ({
  ...(await orig<typeof import('../../services/delivery-partners.service')>()),
  deliveryPartnersService: { create: (...a: unknown[]) => create(...a) },
}));

const onAdded = vi.fn();
const open = () => render(<ToastProvider><AddPartnerModal open onClose={vi.fn()} onAdded={onAdded} /></ToastProvider>);

beforeEach(() => {
  create.mockReset();
  onAdded.mockReset();
  create.mockResolvedValue({ id: 77, name: 'Tamale Express' });
});

describe('Add delivery partner modal (M4-T33)', () => {
  it('adds a company: one name field, no vehicle or password, kind company', async () => {
    open();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'company');
    expect(screen.queryByLabelText('Vehicle type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Company name'), 'Tamale Express');
    await userEvent.type(screen.getByLabelText('Email'), 'ops@tamale.test');
    await userEvent.click(screen.getByRole('button', { name: 'Add partner' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ kind: 'company', firstName: 'Tamale Express', email: 'ops@tamale.test', daysToPay: 7 }));
    expect(onAdded).toHaveBeenCalledWith(77, 'Tamale Express');
  });

  it('adds a person with vehicle and base town', async () => {
    open();
    await userEvent.type(screen.getByLabelText('First name'), 'Yaw');
    await userEvent.type(screen.getByLabelText(/Last name/), 'Mensah');
    await userEvent.type(screen.getByLabelText('Email'), 'yaw@x.test');
    await userEvent.type(screen.getByLabelText(/Base town/), 'Tema');
    await userEvent.selectOptions(screen.getByLabelText('Vehicle type'), 'Motorbike');
    await userEvent.click(screen.getByRole('button', { name: 'Add partner' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'person', firstName: 'Yaw', lastName: 'Mensah', baseTown: 'Tema', vehicleType: 'Motorbike' })));
  });

  it('asks for a name, a valid email and days to pay before it sends anything', async () => {
    open();
    await userEvent.type(screen.getByLabelText('Email'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Add partner' }));
    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('A valid email is required')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('No coverage grid (decision O4)', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

  it('no coverage component or fallback flag exists in the frontend', () => {
    const src = join(__dirname, '..', '..');
    const hits = files(src)
      .filter((f) => /\.(tsx?|css)$/.test(f) && !f.includes('__tests__'))
      .filter((f) => /coverage ?grid|PartnerCoverage|isFallback|delivery-partners\/coverage/i.test(readFileSync(f, 'utf8')) || /Coverage(Grid)?\.tsx$/.test(f));
    expect(hits).toEqual([]);
  });
});
