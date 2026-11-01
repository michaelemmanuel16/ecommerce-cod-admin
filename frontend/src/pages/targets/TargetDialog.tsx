import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select } from '../../components/ui-v2';
import { apiMessage } from '../orders/importText';
import { todayYmd } from '../../utils/format';
import { targetsService, type RoleRow } from '../../services/targets.service';
import { METRICS, type TargetForm, type TargetScopeChoice, unitOf, validateTarget } from './model';

export interface TargetDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a save, so the page can ask again and say it saved. */
  onSaved: (message: string) => void;
  roles: RoleRow[];
  /** What the form starts with (an edit, or a role/person picked from a row). */
  initial: TargetForm;
  /** An existing target is being changed: its scope, role and person are fixed. */
  editing?: boolean;
}

const SCOPES: Array<{ key: TargetScopeChoice; label: string }> = [
  { key: 'role', label: 'A role' }, { key: 'person', label: 'A person' }, { key: 'daily', label: 'A daily activity target' },
];

/** Add target and edit target (F-1103). The value must be more than 0. The server's own message shows when a save is refused. */
export function TargetDialog({ open, onClose, onSaved, roles, initial, editing }: TargetDialogProps) {
  const [form, setForm] = useState<TargetForm>(initial);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setForm(initial); setTouched(false); setServerError(null); } }, [open, initial]);

  const errors = useMemo(() => validateTarget(form), [form]);
  const holders = roles.find((r) => String(r.roleId) === form.roleId)?.holders ?? [];
  const set = (patch: Partial<TargetForm>) => { setForm((f) => ({ ...f, ...patch })); setServerError(null); };
  const setScope = (scope: TargetScopeChoice) => {
    const today = todayYmd();
    set({ scope, metric: METRICS[scope][0].key, userId: '', period: scope === 'daily' ? today : today.slice(0, 7) });
  };

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try {
      await targetsService.save({
        scope: form.scope, metric: form.metric, unit: unitOf(form.scope, form.metric), value: Number(form.value), period: form.period,
        ...(form.scope !== 'daily' && { roleId: Number(form.roleId) }),
        ...(form.scope === 'person' && { userId: Number(form.userId) }),
      });
      onSaved(editing ? 'Target saved' : 'Target added');
      onClose();
    } catch (err) {
      setServerError(await apiMessage(err, 'The target could not be saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const shown = (key: keyof TargetForm) => (touched ? errors[key] : undefined);

  return (
    <Modal
      open={open} onClose={onClose} title={editing ? 'Edit target' : 'Add target'}
      description="A role or person target sits under that month's North Star target. A daily target is for every call rep."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{editing ? 'Save target' : 'Add target'}</Button></>}
    >
      <div className="vstack">
        <Select label="Target for" value={form.scope} disabled={editing} onChange={(e) => setScope(e.target.value as TargetScopeChoice)}>
          {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        {form.scope !== 'daily' && (
          <Select label="Role" value={form.roleId} disabled={editing} error={shown('roleId')} onChange={(e) => set({ roleId: e.target.value, userId: '' })}>
            <option value="">Choose a role</option>
            {roles.map((r) => <option key={r.roleId} value={r.roleId}>{r.roleName}</option>)}
          </Select>
        )}
        {form.scope === 'person' && (
          <Select label="Person" value={form.userId} disabled={editing} error={shown('userId')} onChange={(e) => set({ userId: e.target.value })}>
            <option value="">Choose a person</option>
            {holders.map((h) => <option key={h.userId} value={h.userId}>{h.name}</option>)}
          </Select>
        )}
        <Select label="Metric" value={form.metric} disabled={editing} error={shown('metric')} onChange={(e) => set({ metric: e.target.value })}>
          {METRICS[form.scope].map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </Select>
        <Input
          label={form.scope === 'daily' ? 'Starting on' : 'Month'} type={form.scope === 'daily' ? 'date' : 'month'} value={form.period}
          disabled={editing && form.scope !== 'daily'} error={shown('period')} onChange={(e) => set({ period: e.target.value })}
        />
        <Input label="Value" inputMode="decimal" value={form.value} error={shown('value')} onChange={(e) => set({ value: e.target.value })} />
        {serverError && <p className="tg-err" role="alert">{serverError}</p>}
      </div>
    </Modal>
  );
}
