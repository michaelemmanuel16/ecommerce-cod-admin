import React, { useState } from 'react';
import { Phone, MessageCircle, Copy, Check } from 'lucide-react';
import { normalizePhone } from '../../utils/phone';
import { whatsappUrl } from '../../utils/whatsapp';

export interface PhoneDisplayProps {
  phone: string | null | undefined;
  label?: string;
  large?: boolean;
  showActions?: boolean;
}

export const PhoneDisplay: React.FC<PhoneDisplayProps> = ({
  phone,
  label,
  large = false,
  showActions = true,
}) => {
  const [copied, setCopied] = useState(false);
  const raw = phone ?? '';
  const normalized = normalizePhone(raw);
  const isValid = Boolean(normalized);
  const displayValue = raw;

  const handleCopy = async () => {
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(isValid && normalized ? normalized : raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const waUrl = whatsappUrl(normalized);

  return (
    <div
      className="phone-display"
      data-testid="phone-display"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      {label && <small style={{ color: 'var(--ink-3)', marginRight: 4 }}>{label}</small>}
      <span
        className="phone-number"
        data-testid="phone-number"
        style={{
          fontSize: large ? 18 : 14,
          fontWeight: large ? 700 : 600,
          color: 'var(--ink)',
        }}
      >
        {displayValue || '—'}
      </span>

      {!isValid && raw.trim() !== '' && (
        <span className="tag warn" data-testid="check-number-tag">
          Check number
        </span>
      )}

      {showActions && raw.trim() !== '' && (
        <div className="phone-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {isValid && normalized ? (
            <a
              href={`tel:${normalized}`}
              className="ibtn mini"
              data-testid="tel-call-link"
              title="Call"
              aria-label="Call"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 8,
                textDecoration: 'none',
                background: 'var(--pine-soft)',
                color: 'var(--pine)',
              }}
            >
              <Phone size={14} />
            </a>
          ) : null}

          {isValid && waUrl ? (
            <a
              href={waUrl}
              className="ibtn mini"
              data-testid="whatsapp-link"
              title="WhatsApp"
              aria-label="WhatsApp"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 8,
                textDecoration: 'none',
                background: 'var(--mint-soft)',
                color: 'var(--ok-ink)',
              }}
            >
              <MessageCircle size={14} />
            </a>
          ) : null}

          <button
            type="button"
            className="ibtn mini"
            data-testid="copy-phone-btn"
            onClick={handleCopy}
            title={copied ? 'Copied' : 'Copy number'}
            aria-label={copied ? 'Copied' : 'Copy number'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--card)',
              color: 'var(--ink-2)',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      )}
    </div>
  );
};

export default PhoneDisplay;
