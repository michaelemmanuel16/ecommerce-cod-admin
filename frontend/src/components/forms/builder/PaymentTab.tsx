import React from 'react';
import { Link } from 'react-router-dom';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { currencyCheck, methodMatrix } from '../../../lib/paymentMatrix';

const providerName = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

interface RowProps {
  title: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
  children?: React.ReactNode;
}

const PayRow: React.FC<RowProps> = ({ title, text, checked, disabled, onChange, children }) => (
  <div className={`pay${checked ? '' : ' off'}`}>
    <label className="sw">
      <input type="checkbox" aria-label={title} checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="tg" />
    </label>
    <div style={{ flex: 1 }}>
      <b>{title}</b>
      <small>{text}</small>
      {children}
    </div>
  </div>
);

/**
 * Payment tab (M3b-T13, F-402, F-401): which payment buttons the form shows, by the method matrix (form type and the
 * store's prepaid-physical switch). The server refuses what the matrix forbids; this tab only offers what is allowed.
 */
export const PaymentTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const options = ctx.paymentOptions;

  if (ctx.paymentOptionsFailed) {
    return <p className="banner-note bad" role="alert">Payment options could not be loaded. Reload the page to try again.</p>;
  }
  if (!options) return <p className="hint">Loading payment options…</p>;

  const matrix = methodMatrix(ctx.formType, options.prepaidPhysical);
  const { connection } = options;
  const cod = Boolean(ctx.watch('codEnabled'));
  const deposit = Boolean(ctx.watch('paystackDepositEnabled'));
  const full = Boolean(ctx.watch('paystackFullEnabled'));
  const percent = Number(ctx.watch('depositPercent'));
  const set = (name: 'codEnabled' | 'paystackDepositEnabled' | 'paystackFullEnabled', on: boolean) =>
    ctx.setValue(name, on, { shouldDirty: true });

  const showsOnline = matrix.online_deposit || matrix.online_full;
  const check = showsOnline ? currencyCheck(connection, ctx.currency) : null;
  const blocked = check === 'unsupported';
  const atMax = [cod, deposit, full].filter(Boolean).length >= 2;
  const paused = ctx.formType === 'physical' && !options.prepaidPhysical && (deposit || full);
  const percentBad = deposit && !(Number.isInteger(percent) && percent >= 1 && percent <= 99);

  return (
    <div className="stack">
      <div className="paneh">
        <h3>Payment</h3>
        <p>{showsOnline && ctx.formType === 'physical' ? 'Choose up to two ways to pay. Customers see these as buttons.' : 'How customers pay on this form.'}</p>
      </div>

      <div>
        {matrix.cod && (
          <PayRow
            title="Cash on delivery"
            text="The delivery agent collects the money."
            checked={options.prepaidPhysical ? cod : true}
            disabled={!options.prepaidPhysical || (!cod && atMax)}
            onChange={(on) => set('codEnabled', on)}
          />
        )}
        {matrix.online_deposit && (
          <PayRow
            title="Pay a deposit online"
            text="Customer pays part online, the rest on delivery."
            checked={deposit}
            disabled={(!deposit && atMax) || (blocked && !deposit)}
            onChange={(on) => set('paystackDepositEnabled', on)}
          >
            {deposit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <input
                  className="cin"
                  style={{ width: 80 }}
                  type="number"
                  min={1}
                  max={99}
                  aria-label="Deposit percent"
                  aria-invalid={percentBad ? true : undefined}
                  value={Number.isNaN(percent) ? '' : percent}
                  onChange={(e) => ctx.setValue('depositPercent', Number(e.target.value), { shouldDirty: true })}
                />
                <span className="hint" style={{ margin: 0 }}>% paid online</span>
              </div>
            )}
            {percentBad && <p className="err" role="alert">Deposit must be a whole number from 1 to 99.</p>}
          </PayRow>
        )}
        {matrix.online_full && (
          <PayRow
            title={ctx.formType === 'digital' ? 'Online payment in full' : 'Pay in full online'}
            text="Customer pays everything online."
            checked={ctx.formType === 'digital' ? true : full}
            disabled={ctx.formType === 'digital' || (!full && atMax) || (blocked && !full)}
            onChange={(on) => set('paystackFullEnabled', on)}
          />
        )}
      </div>

      {atMax && ctx.formType === 'physical' && showsOnline && <p className="fnote">Two methods are on. Turn one off to pick another.</p>}
      {paused && <p className="banner-note warn">Online payment is paused for physical products.</p>}

      {showsOnline && (
        <div className="stack" style={{ gap: 8 }}>
          {connection ? (
            <p className="hint" style={{ margin: 0 }}>
              Online payments go through {providerName(connection.provider)} ({connection.mode} mode).
              {connection.mode === 'test' && ' Real customers cannot pay yet.'}
            </p>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              <Link to="/connections">Connect a payment provider in Connections.</Link>
            </p>
          )}
          {check === 'unsupported' && (
            <p className="banner-note warn" role="alert">This payment account cannot take {ctx.currency}. Connect another account or provider.</p>
          )}
          {check === 'untested' && (
            <p className="hint" style={{ margin: 0 }}>Test the connection in Connections to check which currencies it takes.</p>
          )}
        </div>
      )}
    </div>
  );
};
