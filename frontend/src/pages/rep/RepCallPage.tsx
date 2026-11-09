import { useNavigate, useParams } from 'react-router-dom';
import { CallCard } from '../../components/rep/CallCard';
import { useV2Page } from '../../components/shell/useV2Page';

export function RepCallPage() {
  useV2Page();
  const { orderId } = useParams();
  const navigate = useNavigate();

  const id = Number(orderId);
  if (!orderId || Number.isNaN(id) || id <= 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p>Invalid order id.</p>
        <button type="button" onClick={() => navigate('/rep/queue')}>
          Back to queue
        </button>
      </div>
    );
  }

  return (
    <div className="rep-call-page" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <CallCard
        orderId={id}
        onBack={() => navigate('/rep/queue')}
        onDone={(nextOrderId) => {
          if (nextOrderId) {
            navigate(`/rep/call/${nextOrderId}`);
          } else {
            navigate('/rep/queue');
          }
        }}
      />
    </div>
  );
}

export default RepCallPage;
