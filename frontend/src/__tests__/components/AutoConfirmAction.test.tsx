import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionsStep } from '../../components/workflows/steps/ActionsStep';
import { ReviewStep } from '../../components/workflows/steps/ReviewStep';
import { workflowActionSchema } from '../../validation/schemas';
import type { WorkflowFormData } from '../../pages/WorkflowWizard';

vi.mock('../../components/workflows/ExecutionHistory', () => ({
  ExecutionHistory: () => null,
}));
vi.mock('../../services/workflows.service', () => ({
  workflowsService: {},
}));

const BASE: WorkflowFormData = {
  name: 'Confirm new orders',
  description: '',
  isActive: true,
  triggerType: 'order_created',
  triggerConfig: {},
  actions: [],
};

let latest: WorkflowFormData = BASE;

function Harness() {
  const [formData, setFormData] = useState<WorkflowFormData>(BASE);
  latest = formData;
  return <ActionsStep formData={formData} onUpdate={(u) => setFormData((f) => ({ ...f, ...u }))} />;
}

describe('send_auto_confirm workflow action', () => {
  it('is in the builder, saves the chosen channel, and shows in sequence and review', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: /Add Your First Action/i }));
    await userEvent.click(screen.getByRole('button', { name: /Send auto-confirm message/i }));

    expect(screen.getByText('Configure auto-confirm message')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sends the confirm request with Confirm, Change and Cancel buttons. Each order gets it once. SMS asks the customer to reply YES or NO.',
      ),
    ).toBeInTheDocument();

    const channel = screen.getByLabelText('Channel');
    expect(channel).toHaveValue('whatsapp');
    await userEvent.selectOptions(channel, 'sms');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

    expect(latest.actions).toHaveLength(1);
    expect({ type: latest.actions[0].type, config: latest.actions[0].config }).toEqual({
      type: 'send_auto_confirm',
      config: { channel: 'sms' },
    });
    expect(workflowActionSchema.safeParse({ type: 'send_auto_confirm', config: { channel: 'sms' } }).success).toBe(true);

    // ActionSequence
    expect(screen.getByText('Send auto-confirm message')).toBeInTheDocument();
    expect(screen.getByText('Channel: SMS')).toBeInTheDocument();

    // ReviewStep
    render(
      <ReviewStep
        formData={latest}
        isEditMode={false}
        onEdit={() => {}}
        onSave={() => {}}
        onBack={() => {}}
        saving={false}
      />,
    );
    expect(screen.getAllByText('Send auto-confirm message').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Channel: SMS/).length).toBeGreaterThan(1);
  });
});
