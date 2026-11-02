import React from 'react';
import { Check, Circle } from 'lucide-react';
import { Input } from '../ui-v2';
import { RULES, type NewPasswordErrors } from '../../lib/passwordRules';

interface Props {
  password: string;
  confirm: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  errors: NewPasswordErrors;
  passwordLabel?: string;
  passwordPlaceholder?: string;
  confirmPlaceholder?: string;
}

/** The password, its rules ticking as it grows, and the confirm field. Reset password and accept invite share it. */
export const NewPasswordFields: React.FC<Props> = ({
  password, confirm, onPasswordChange, onConfirmChange, errors,
  passwordLabel = 'New password', passwordPlaceholder = 'Enter new password', confirmPlaceholder = 'Confirm new password',
}) => (
  <>
    <Input
      label={passwordLabel}
      type="password"
      autoComplete="new-password"
      value={password}
      onChange={(e) => onPasswordChange(e.target.value)}
      error={errors.password}
      placeholder={passwordPlaceholder}
    />
    <ul className="rules" aria-label="Password rules">
      {RULES.map((r) => {
        const met = r.test(password);
        return (
          <li key={r.id} className={met ? 'met' : undefined}>
            {met ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
            {r.text}
          </li>
        );
      })}
    </ul>
    <Input
      label="Confirm password"
      type="password"
      autoComplete="new-password"
      value={confirm}
      onChange={(e) => onConfirmChange(e.target.value)}
      error={errors.confirm}
      placeholder={confirmPlaceholder}
    />
  </>
);
