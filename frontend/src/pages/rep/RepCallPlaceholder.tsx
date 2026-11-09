import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatOrderNumber } from '../../utils/orderNumber';

export const RepCallPlaceholder: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const idNum = orderId ? parseInt(orderId, 10) : null;
  const formattedId = idNum && !isNaN(idNum) ? formatOrderNumber(idNum) : `#${orderId ?? ''}`;

  return (
    <div className="rep-call-placeholder" data-testid="rep-call-placeholder">
      <div className="head">
        <div>
          <Link
            to="/rep/queue"
            className="back"
            data-testid="back-to-queue"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 12,
              color: 'var(--pine)',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            <ArrowLeft size={16} />
            <span>Back to Queue</span>
          </Link>
          <h1>Call order {formattedId}</h1>
          <p>Order {orderId} call card</p>
        </div>
      </div>
      <div
        className="card pad"
        style={{ padding: 24, marginTop: 16 }}
      >
        <p>Order ID: <b data-testid="placeholder-order-id">{orderId}</b></p>
        <p style={{ marginTop: 8, color: 'var(--ink-2)' }}>
          Call card interface will be rendered here.
        </p>
      </div>
    </div>
  );
};

export default RepCallPlaceholder;
