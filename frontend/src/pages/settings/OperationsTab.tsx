import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, Input, Select, useToast } from '../../components/ui-v2';
import {
  adminService,
  type DayHours,
  type OperationsSettings,
  type UpdateOperationsSettingsData,
} from '../../services/admin.service';

const DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
] as const;

type DayKey = (typeof DAYS)[number]['key'];

const DEFAULT_DAYS: Record<DayKey, DayHours> = {
  monday: { open: '08:00', close: '20:00', enabled: true },
  tuesday: { open: '08:00', close: '20:00', enabled: true },
  wednesday: { open: '08:00', close: '20:00', enabled: true },
  thursday: { open: '08:00', close: '20:00', enabled: true },
  friday: { open: '08:00', close: '20:00', enabled: true },
  saturday: { open: '09:00', close: '18:00', enabled: true },
  sunday: { open: '10:00', close: '16:00', enabled: false },
};

interface OperationsTabProps {
  editable?: boolean;
}

/**
 * Settings, Operations (M7-T21, F-1229).
 * Operating hours per weekday, queue wait alert, first-call target, default days to pay,
 * low stock days of cover, auto-confirm switch and channel.
 */
export function OperationsTab({ editable = true }: OperationsTabProps) {
  const say = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState<Record<DayKey, DayHours>>(DEFAULT_DAYS);
  const [storeZone, setStoreZone] = useState('Africa/Accra');
  const [queueWaitAlertMinutes, setQueueWaitAlertMinutes] = useState('30');
  const [firstCallTargetMinutes, setFirstCallTargetMinutes] = useState('15');
  const [defaultDaysToPay, setDefaultDaysToPay] = useState('7');
  const [lowStockCoverDays, setLowStockCoverDays] = useState('14');
  const [autoConfirmEnabled, setAutoConfirmEnabled] = useState(false);
  const [autoConfirmChannel, setAutoConfirmChannel] = useState<'whatsapp' | 'sms'>('whatsapp');

  const applySettings = (data: OperationsSettings) => {
    if (data.timeZone) setStoreZone(data.timeZone);
    if (data.queueWaitAlertMinutes !== undefined) setQueueWaitAlertMinutes(String(data.queueWaitAlertMinutes));
    if (data.firstCallTargetMinutes !== undefined) setFirstCallTargetMinutes(String(data.firstCallTargetMinutes));
    if (data.defaultDaysToPay !== undefined) setDefaultDaysToPay(String(data.defaultDaysToPay));
    if (data.lowStockCoverDays !== undefined) setLowStockCoverDays(String(data.lowStockCoverDays));
    setAutoConfirmEnabled(Boolean(data.autoConfirmEnabled));
    setAutoConfirmChannel(data.autoConfirmChannel === 'sms' ? 'sms' : 'whatsapp');

    const incoming = data.operatingHours?.days || {};
    const nextDays: Record<DayKey, DayHours> = { ...DEFAULT_DAYS };
    for (const d of DAYS) {
      if (incoming[d.key]) {
        nextDays[d.key] = {
          open: incoming[d.key]?.open || DEFAULT_DAYS[d.key].open,
          close: incoming[d.key]?.close || DEFAULT_DAYS[d.key].close,
          enabled: incoming[d.key]?.enabled ?? DEFAULT_DAYS[d.key].enabled,
        };
      }
    }
    setDays(nextDays);
  };

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminService.getOperationsSettings();
      applySettings(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to load operations settings';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const updateDay = (key: DayKey, patch: Partial<DayHours>) => {
    setDays((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload: UpdateOperationsSettingsData = {
        operatingHours: {
          days,
          queueWaitAlertMinutes: Number(queueWaitAlertMinutes),
          firstCallTargetMinutes: Number(firstCallTargetMinutes),
          defaultDaysToPay: Number(defaultDaysToPay),
          lowStockCoverDays: Number(lowStockCoverDays),
        },
        queueWaitAlertMinutes: Number(queueWaitAlertMinutes),
        firstCallTargetMinutes: Number(firstCallTargetMinutes),
        defaultDaysToPay: Number(defaultDaysToPay),
        lowStockCoverDays: Number(lowStockCoverDays),
        autoConfirmEnabled,
        autoConfirmChannel,
      };
      const res = await adminService.updateOperationsSettings(payload);
      applySettings(res);
      say('Operations settings saved');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message ||
        'The operations settings could not be saved';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="secs">
      <Card
        title="Operating hours"
        aside={storeZone ? `Store zone: ${storeZone} (set in Business details)` : undefined}
      >
        <div className="sub" style={{ paddingBottom: 6 }}>
          When reps take calls
          <small>
            The time-to-first-call clock runs only inside these hours. An order at 22:00 starts counting at opening time.
            The auto-confirm message still goes out at once.
          </small>
        </div>
        <div id="hours" style={{ marginTop: 6 }}>
          {DAYS.map(({ key, label }) => {
            const row = days[key];
            return (
              <div key={key} className="hr" data-d={label}>
                <b>{label}</b>
                <input
                  type="time"
                  value={row.open}
                  aria-label={`${label} opens`}
                  disabled={!row.enabled || !editable || loading}
                  onChange={(e) => updateDay(key, { open: e.target.value })}
                />
                <input
                  type="time"
                  value={row.close}
                  aria-label={`${label} closes`}
                  disabled={!row.enabled || !editable || loading}
                  onChange={(e) => updateDay(key, { close: e.target.value })}
                />
                <button
                  type="button"
                  className="sw"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={`${label} open`}
                  disabled={!editable || loading}
                  onClick={() => updateDay(key, { enabled: !row.enabled })}
                />
              </div>
            );
          })}
        </div>
        <p className="hint" style={{ margin: '10px 20px 6px' }}>
          Public holidays are not counted yet.
        </p>
        {error && (
          <div className="opserr" role="alert">
            {error}
          </div>
        )}
      </Card>

      <Card title="Queue and stock rules">
        <div className="fields">
          <Input
            label="Queue wait alert (minutes)"
            type="number"
            min={1}
            value={queueWaitAlertMinutes}
            disabled={!editable || loading}
            onChange={(e) => setQueueWaitAlertMinutes(e.target.value)}
            hint="Alert when an order waits this long for a first call."
          />
          <Input
            label="Time to first call target (minutes)"
            type="number"
            min={1}
            value={firstCallTargetMinutes}
            disabled={!editable || loading}
            onChange={(e) => setFirstCallTargetMinutes(e.target.value)}
            hint="Median now 9 min. Counted inside operating hours, to the first call attempt."
          />
          <Input
            label="Default days to pay"
            type="number"
            min={0}
            value={defaultDaysToPay}
            disabled={!editable || loading}
            onChange={(e) => setDefaultDaysToPay(e.target.value)}
            hint="Used for each new delivery partner. Change one partner in Deliveries."
          />
          <Input
            label="Low stock alert (days of cover)"
            type="number"
            min={1}
            value={lowStockCoverDays}
            disabled={!editable || loading}
            onChange={(e) => setLowStockCoverDays(e.target.value)}
            hint="Alert when stock covers fewer days than this. Each product can override it."
          />
        </div>
      </Card>

      <Card title="Auto-confirm" aside="Automatic confirmation for incoming COD orders">
        <div style={{ padding: '16px 20px 4px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label className="chk">
            <input
              type="checkbox"
              checked={autoConfirmEnabled}
              disabled={!editable || loading}
              onChange={(e) => setAutoConfirmEnabled(e.target.checked)}
            />
            Send auto-confirmation message for new COD orders
          </label>
          <p className="hint" style={{ margin: 0 }}>
            Sends an immediate WhatsApp or SMS message with confirmation options when a new order arrives.
          </p>
          <div style={{ maxWidth: 320 }}>
            <Select
              label="Auto-confirm channel"
              value={autoConfirmChannel}
              disabled={!autoConfirmEnabled || !editable || loading}
              onChange={(e) => setAutoConfirmChannel(e.target.value as 'whatsapp' | 'sms')}
              hint="Channel used to deliver confirmation messages to customers."
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </Select>
          </div>
        </div>
        {editable && (
          <div className="cardfoot">
            <Button variant="primary" type="submit" disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save operations'}
            </Button>
          </div>
        )}
      </Card>
    </form>
  );
}
