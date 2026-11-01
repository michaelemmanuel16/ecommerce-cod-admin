import { useState } from 'react';
import { Button, Modal, useToast } from '../../components/ui-v2';
import { NewPasswordFields } from '../../components/auth/NewPasswordFields';
import { validateNewPassword, type NewPasswordErrors } from '../../lib/passwordRules';
import { staffService, type StaffRow } from '../../services/staff.service';
import { apiMessage } from '../orders/importText';

/** An admin types a new password for a person (F-1160); the person is signed out everywhere. Same rules as reset password. */
export function ResetPasswordModal({ row, onClose }: { row: StaffRow; onClose: () => void }) {
  const say = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<NewPasswordErrors>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const next = validateNewPassword(password, confirm);
    setErrors(next);
    if (next.password || next.confirm) return;
    setBusy(true);
    try {
      await staffService.resetPassword(row.id, password);
      say(`Password changed for ${row.name}`);
      onClose();
    } catch (err) {
      say(await apiMessage(err, 'The password could not be changed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open onClose={onClose} title={`Reset password for ${row.name}`} description="They are signed out on every device and use the new password next time."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>Reset password</Button></>}
    >
      <NewPasswordFields password={password} confirm={confirm} onPasswordChange={setPassword} onConfirmChange={setConfirm} errors={errors} />
    </Modal>
  );
}
