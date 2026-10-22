import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TownSelect } from '../../components/forms/TownSelect';

const TOWNS: Record<string, string[]> = { Ashanti: ['Adum', 'Kejetia'], 'Greater Accra': ['Madina', 'Tema'] };

/** A tiny form: a state picker and the town select. */
function Harness({ initialState = '', initialTown = '' }: { initialState?: string; initialTown?: string }) {
  const [state, setState] = useState(initialState);
  const [town, setTown] = useState(initialTown);
  return (
    <>
      <select aria-label="State" value={state} onChange={(e) => setState(e.target.value)}>
        <option value="" />
        <option>Ashanti</option>
        <option>Greater Accra</option>
      </select>
      <TownSelect state={state} value={town} onChange={setTown} towns={TOWNS[state] ?? []} />
      <output data-testid="town">{town}</output>
    </>
  );
}

describe('TownSelect (COD-138)', () => {
  it('is disabled until a state is chosen', async () => {
    render(<Harness />);
    expect(screen.getByLabelText('City/Town')).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('State'), 'Ashanti');
    expect(screen.getByLabelText('City/Town')).toBeEnabled();
  });

  it('lists the towns of the state with "Other – type it" last', async () => {
    render(<Harness initialState="Ashanti" />);
    const options = Array.from((screen.getByLabelText('City/Town') as HTMLSelectElement).options).map((o) => o.text);
    expect(options).toEqual(['Choose city/town', 'Adum', 'Kejetia', 'Other – type it']);
  });

  it('clears the town when the state changes', async () => {
    render(<Harness initialState="Ashanti" initialTown="Adum" />);
    expect(screen.getByLabelText('City/Town')).toHaveValue('Adum');
    await userEvent.selectOptions(screen.getByLabelText('State'), 'Greater Accra');
    expect(screen.getByTestId('town')).toHaveTextContent('');
    expect(screen.getByLabelText('City/Town')).toHaveValue('');
  });

  it('"Other – type it" shows an input, and what is typed becomes the town', async () => {
    render(<Harness initialState="Ashanti" />);
    expect(screen.queryByLabelText('City/Town (type it)')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('City/Town'), 'Other – type it');
    const input = screen.getByLabelText('City/Town (type it)');
    await userEvent.type(input, 'Nsuta');
    expect(screen.getByTestId('town')).toHaveTextContent('Nsuta');
    expect(screen.getByLabelText('City/Town')).toHaveValue('__other__');
  });

  it('keeps a value that is not in the list, shown through the input', () => {
    render(<Harness initialState="Ashanti" initialTown="Old Tafo" />);
    expect(screen.getByLabelText('City/Town')).toHaveValue('__other__');
    expect(screen.getByLabelText('City/Town (type it)')).toHaveValue('Old Tafo');
  });

  it('a state with no towns goes straight to the input', () => {
    render(<TownSelect state="Oti" value="" onChange={() => undefined} towns={[]} />);
    expect(screen.getByLabelText('City/Town')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
