import { useState } from 'react';
import { Modal, Skeleton } from '../../components/ui-v2';
import type { OrderProof } from '../../services/delivery-partners.service';
import { formatCurrency } from '../../utils/format';
import { photoSrc } from '../../utils/photoSrc';
import { failureReasonLabel } from '../orders/reasons';
import { shortDate } from '../orders/model';

/** A small proof photo that opens large. A photo that fails to load shows a placeholder (F-711). */
export function ProofThumb({ url, big, onOpen }: { url: string; big?: boolean; onOpen?: () => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="proofph" aria-label="Photo could not load">No photo</span>;
  const img = <img src={photoSrc(url)} alt="Delivery proof" loading="lazy" className={big ? 'proofbig' : 'proofthumb'} onError={() => setBroken(true)} />;
  return onOpen ? (
    <button type="button" className="proofbtn" onClick={onOpen} aria-label="Open the delivery proof photo">{img}</button>
  ) : img;
}

/** Delivery proof and attempts of one order (F-711, F-713): recipient, time, cash collected, photo, attempts. */
export function ProofBlock({ data }: { data: OrderProof | 'error' | null }) {
  const [open, setOpen] = useState(false);
  if (data === null) return <Skeleton height={60} />;
  if (data === 'error') return <p className="mut">The proof could not load.</p>;
  const { proof, attempts } = data;
  return (
    <div className="proofblock">
      {proof.recorded ? (
        <div className="proofrow">
          {proof.photoUrl && <ProofThumb url={proof.photoUrl} onOpen={() => setOpen(true)} />}
          <dl>
            <div><dt>Recipient</dt><dd>{proof.recipientName ?? '—'}</dd></div>
            <div><dt>Time</dt><dd>{proof.time ? shortDate(proof.time) : '—'}</dd></div>
            <div><dt>Cash collected</dt><dd>{proof.cashCollected === null ? '—' : formatCurrency(proof.cashCollected)}</dd></div>
          </dl>
        </div>
      ) : (
        <p className="mut">No proof recorded</p>
      )}
      {attempts.length > 0 && (
        <ol className="attempts" aria-label="Delivery attempts">
          {attempts.map((a) => (
            <li key={a.id}>
              <b>{shortDate(a.attemptedAt)}</b> {a.reason ? failureReasonLabel(a.reason) : 'No reason'}
              {a.note ? `. ${a.note}` : ''} <span className="mut">by {a.partner.name}</span>
            </li>
          ))}
        </ol>
      )}
      {proof.photoUrl && (
        <Modal open={open} onClose={() => setOpen(false)} title="Delivery proof">
          <ProofThumb url={proof.photoUrl} big />
        </Modal>
      )}
    </div>
  );
}
