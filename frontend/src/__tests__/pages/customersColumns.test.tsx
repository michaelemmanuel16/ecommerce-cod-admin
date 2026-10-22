import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildColumns } from '../../pages/customers/columns';
import { customer } from '../fixtures/customersList';

const columns = buildColumns({ sort: null, onSort: () => undefined });
const state = columns.find((c) => c.key === 'state')!;

describe('Customers table State column (COD-139)', () => {
  it('has a State header and no City/Town header', () => {
    expect(columns.map((c) => c.header).filter((h) => typeof h === 'string')).toContain('State');
    expect(columns.map((c) => c.header)).not.toContain('City/Town');
  });

  it('shows the customer state, with Greater Accra (Tema) as Greater Accra, and a dash when empty', () => {
    render(<div>
      <span data-testid="a">{state.render(customer(1, { state: 'Ashanti' }))}</span>
      <span data-testid="b">{state.render(customer(2, { state: 'Greater Accra (Tema)' }))}</span>
      <span data-testid="c">{state.render(customer(3, { state: '' }))}</span>
    </div>);
    expect(screen.getByTestId('a')).toHaveTextContent('Ashanti');
    expect(screen.getByTestId('b')).toHaveTextContent(/^Greater Accra$/);
    expect(screen.getByTestId('c')).toHaveTextContent('—');
  });
});
