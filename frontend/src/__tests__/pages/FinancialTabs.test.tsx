import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Financial } from '../../pages/Financial';

let canView = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: (r: string, a: string) => (r === 'payouts' && a === 'view' ? canView : true) }) }));
vi.mock('../../pages/financial/overview/FinanceOverview', () => ({ FinanceOverview: () => <div>overview</div> }));
vi.mock('../../pages/financial/AgentCollections', () => ({ AgentCollections: () => <div>collections</div> }));
vi.mock('../../pages/financial/AccountingAnalysis', () => ({ AccountingAnalysis: () => <div>accounting</div> }));
vi.mock('../../pages/financial/RepCommissions', () => ({ RepCommissions: () => <div>rep commissions content</div> }));
vi.mock('../../pages/financial/profit/OverviewProfitCards', () => ({ OverviewProfitCards: () => <div>overview profit cards</div> }));
vi.mock('../../pages/financial/cash/CashFlowPanel', () => ({ CashFlowPanel: () => <div>cash flow</div> }));
vi.mock('../../pages/financial/cash/ExportMenu', () => ({ ExportMenu: () => null }));
vi.mock('../../components/ui/DateRangePicker', () => ({ DateRangePicker: () => null }));

beforeEach(() => {
  canView = true;
});

const open = () => render(<MemoryRouter><Financial /></MemoryRouter>);

describe('Finance tabs (M5-T38)', () => {
  it('shows the Rep commissions tab to a role with payouts:view', () => {
    open();
    expect(screen.getByRole('button', { name: 'Rep commissions' })).toBeInTheDocument();
  });

  it('hides it from a role without payouts:view', () => {
    canView = false;
    open();
    expect(screen.queryByRole('button', { name: 'Rep commissions' })).not.toBeInTheDocument();
  });
});
