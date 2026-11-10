import React from 'react';
import { Link } from 'react-router-dom';
import { Phone } from 'lucide-react';
import { formatOrderNumber } from '../../utils/orderNumber';

export interface QueueCallPanelProps {
  orderId: number;
  onDone: (nextOrderId: number | null) => void;
}

export const QueueCallPanel: React.FC<QueueCallPanelProps> = ({ orderId }) => {
  return (
    <div className="card callpanel open" data-testid="queue-call-panel">
      <div className="cc-head" style={{ padding: '18px 20px' }}>
        <h2>Order {formatOrderNumber(orderId)}</h2>
      </div>
      <div className="blk" style={{ padding: '14px 20px', borderTop: '1px solid var(--line)' }}>
        <p style={{ marginBottom: 12 }}>
          Selected order ID: <b data-testid="panel-order-id">{orderId}</b>
        </p>
        <Link
          to={`/rep/call/${orderId}`}
          className="btn pri"
          data-testid="open-call-card-link"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            textDecoration: 'none',
          }}
        >
          <Phone size={16} />
          <span>Open call card</span>
        </Link>
      </div>
    </div>
  );
};

export default QueueCallPanel;
