import React from 'react';
import { CallCard } from '../../components/rep/CallCard';

export interface QueueCallPanelProps {
  orderId: number;
  onDone: (nextOrderId: number | null) => void;
}

/** The call card for the selected queue row (M7-T16). A new order id mounts a fresh card. */
export const QueueCallPanel: React.FC<QueueCallPanelProps> = ({ orderId, onDone }) => (
  <div className="card callpanel open" data-testid="queue-call-panel">
    <CallCard key={orderId} orderId={orderId} onDone={onDone} />
  </div>
);

export default QueueCallPanel;
