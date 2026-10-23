import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UserMenu } from '../../../components/shell/UserMenu';
import { useAuthStore } from '../../../stores/authStore';
import { initials, personName } from '../../../utils/people';

describe('one initials rule (F7c)', () => {
  it('the user menu shows the same initials as the Orders and Customers screens for "Ama Kofi Mensah"', () => {
    // the server splits a full name on the last space: first name "Ama Kofi", last name "Mensah"
    const me = { firstName: 'Ama Kofi', lastName: 'Mensah' };
    useAuthStore.setState({ user: { id: 1, role: 'admin', photoUrl: null, ...me } as never, roles: null });
    render(<MemoryRouter><UserMenu /></MemoryRouter>);
    expect(initials(personName(me))).toBe('AM');
    expect(screen.getByRole('button', { name: /account|menu|profile/i })).toHaveTextContent('AM');
  });
});
