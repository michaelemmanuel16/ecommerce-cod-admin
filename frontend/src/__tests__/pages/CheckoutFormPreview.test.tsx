import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Mocked before importing the component under test.
const mockUseParams = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => mockUseParams(),
}));

const getPreviewConfig = vi.fn();
vi.mock('../../services/checkout-forms.service', () => ({
  checkoutFormsService: {
    getCheckoutFormPreviewConfig: (...args: any[]) => getPreviewConfig(...args),
  },
}));

// Render just the form name so we can assert the streamed draft lands.
vi.mock('../../components/public/CheckoutForm', () => ({
  CheckoutForm: ({ formData }: any) => (
    <div data-testid="public-form">{formData?.name ?? ''}</div>
  ),
}));

import { CheckoutFormPreview } from '../../pages/CheckoutFormPreview';

const sendPatch = (patch: Record<string, any>) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'checkout-preview-update', patch },
        origin: window.location.origin,
        source: window,
      })
    );
  });
};

describe('CheckoutFormPreview (create mode)', () => {
  beforeEach(() => {
    getPreviewConfig.mockReset();
    mockUseParams.mockReset();
  });

  it('does not fetch a saved form when id is "new" and renders from the streamed draft', () => {
    mockUseParams.mockReturnValue({ id: 'new' });
    render(<CheckoutFormPreview />);

    // Create mode never hits the preview-config endpoint.
    expect(getPreviewConfig).not.toHaveBeenCalled();
    // Renders immediately over the empty base (no spinner stuck, no error).
    expect(screen.getByTestId('public-form')).toBeInTheDocument();

    // A streamed draft patch shows live.
    sendPatch({ name: 'Live Draft Name' });
    expect(screen.getByTestId('public-form')).toHaveTextContent('Live Draft Name');
  });
});
