import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpIntegration } from '../../components/settings/integrations/McpIntegration';
import api from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const RAW_KEY = 'mcp_' + 'a1'.repeat(32);

const roles = [
  { id: 1, name: 'Owner', toolCount: 14 },
  { id: 2, name: 'Call rep', toolCount: 4 },
];

const existing = {
  id: 'k1', keyPrefix: 'mcp_a1b2c3d4', label: 'Desktop', createdAt: new Date().toISOString(), expiresAt: null,
  lastUsedAt: null, roleName: 'Call rep', toolCount: 4,
};

let keys: Array<typeof existing>;

beforeEach(() => {
  vi.clearAllMocks();
  keys = [existing];
  (api.get as any).mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/api/roles' ? { roles } : { keys } }));
  (api.post as any).mockResolvedValue({
    data: {
      id: 'k2', key: RAW_KEY, keyPrefix: RAW_KEY.slice(0, 12), label: 'Claude', expiresAt: null,
      mcpConfig: {
        remote: { mcpServers: { 'cod-admin': { type: 'http', url: 'https://app.test/mcp', headers: { Authorization: `Bearer ${RAW_KEY}` } } } },
        local: { mcpServers: { 'cod-admin': { command: 'node', args: ['/app/mcp/server.js'], env: { COD_ADMIN_API_KEY: RAW_KEY } } } },
      },
    },
  });
  (api.delete as any).mockResolvedValue({ data: {} });
});

const renderCard = () => render(<MemoryRouter><McpIntegration /></MemoryRouter>);

async function openCreateForm() {
  renderCard();
  await screen.findByText('Desktop');
  fireEvent.click(screen.getByRole('button', { name: /Generate Key/i }));
}

describe('McpIntegration (AI Assistant card)', () => {
  it('lists name, role, tool count and masked key, with a Roles and tools link', async () => {
    renderCard();
    expect(await screen.findByText('Desktop')).toBeInTheDocument();
    expect(screen.getByText('Call rep')).toBeInTheDocument();
    expect(screen.getByText('4 tools')).toBeInTheDocument();
    expect(screen.getByText('mcp_a1b2c3d4...****')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Roles and tools/i })).toHaveAttribute('href', '/settings?tab=users');
  });

  it('create needs a name and a role, then posts both', async () => {
    await openCreateForm();
    const submit = screen.getByRole('button', { name: 'Generate' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Claude' } });
    expect(submit).toBeDisabled();
    expect(api.get).toHaveBeenCalledWith('/api/roles');
    await screen.findByRole('option', { name: /Call rep/ });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: '2' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/mcp-keys', { label: 'Claude', roleId: 2 }));
  });

  it('shows the key and config once; closing removes them', async () => {
    await openCreateForm();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Claude' } });
    await screen.findByRole('option', { name: /Call rep/ });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText(RAW_KEY)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/app.test\/mcp/)).toBeInTheDocument();
    expect(screen.getByTitle('Copy key')).toBeInTheDocument();
    expect(screen.getByTitle('Copy config')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Local \(stdio\)/ }));
    expect(screen.getByText(/server\.js/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /I've saved this key/i }));
    await waitFor(() => expect(screen.queryByText(RAW_KEY)).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(RAW_KEY);
  });

  it('revoke asks for confirmation, and cancel does not revoke', async () => {
    renderCard();
    await screen.findByText('Desktop');
    fireEvent.click(screen.getByTitle('Revoke key'));
    expect(screen.getByText('Revoke API Key')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Revoke key'));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/mcp-keys/k1'));
  });
});
