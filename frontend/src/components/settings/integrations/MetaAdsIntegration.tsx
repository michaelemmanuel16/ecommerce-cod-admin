import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Tag } from '../../ui-v2';
import { usePermissions } from '../../../hooks/usePermissions';
import { metaAdsService, MetaAdAccount, MetaPickAccount } from '../../../services/metaAds.service';
import { MetaAdsPickerModal } from './MetaAdsPickerModal';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const apiMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

export const MetaAdsIntegration: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePermissions();
  const canUpdate = can('marketing', 'update');

  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pickId, setPickId] = useState<string | null>(null);
  const [pickAccounts, setPickAccounts] = useState<MetaPickAccount[] | null>(null);
  const [pickSaving, setPickSaving] = useState(false);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [removing, setRemoving] = useState<MetaAdAccount | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await metaAdsService.getAccounts());
      setLoadError(null);
    } catch {
      setLoadError('Failed to load ad accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // Meta sends the browser back with ?metaAds=pick&pick=<id> or ?metaAds=error&message=<text>. Read it once, then clear it.
  useEffect(() => {
    const result = searchParams.get('metaAds');
    if (!result) return;
    if (result === 'pick' && searchParams.get('pick')) {
      const id = searchParams.get('pick') as string;
      setPickId(id);
      metaAdsService.getPickAccounts(id)
        .then(setPickAccounts)
        .catch((err) => {
          setPickId(null);
          setConnectError(apiMessage(err, 'Could not load your Meta ad accounts. Try connecting again.'));
        });
    } else if (result === 'error') {
      setConnectError(searchParams.get('message') || 'Meta Ads connection failed');
    }
    const params = new URLSearchParams(searchParams);
    ['metaAds', 'pick', 'message'].forEach((k) => params.delete(k));
    setSearchParams(params, { replace: true });
  }, []); // Run once on mount, like the WhatsApp callback

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const { authUrl } = await metaAdsService.initiate();
      // Same tab: Meta sends the browser back to Settings (no new tab, the in-app browsers lose it)
      window.location.assign(authUrl);
    } catch (err) {
      setConnectError(apiMessage(err, 'Failed to start the Meta Ads connection'));
      setConnecting(false);
    }
  };

  const closePicker = () => { setPickId(null); setPickAccounts(null); };

  const handlePickSave = async (accountIds: string[]) => {
    if (!pickId) return;
    setPickSaving(true);
    try {
      await metaAdsService.savePick(pickId, accountIds);
      toast.success('Ad accounts saved');
      closePicker();
      await loadAccounts();
    } catch (err) {
      toast.error(apiMessage(err, 'Failed to save ad accounts'));
    } finally {
      setPickSaving(false);
    }
  };

  const handleToggle = async (a: MetaAdAccount) => {
    try {
      await metaAdsService.setEnabled(a.id, !a.enabled);
      setAccounts((cur) => cur.map((x) => (x.id === a.id ? { ...x, enabled: !a.enabled } : x)));
    } catch (err) {
      toast.error(apiMessage(err, 'Failed to update the ad account'));
    }
  };

  const handleRefresh = async (a: MetaAdAccount) => {
    setRefreshing(a.id);
    setRowErrors((cur) => ({ ...cur, [a.id]: '' }));
    try {
      const res = await metaAdsService.refresh(a.id);
      setAccounts((cur) => cur.map((x) => (x.id === a.id ? { ...x, lastPulledAt: res.lastPulledAt, lastPullError: res.lastPullError } : x)));
    } catch (err) {
      setRowErrors((cur) => ({ ...cur, [a.id]: apiMessage(err, 'Refresh failed') }));
    } finally {
      setRefreshing(null);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    const target = removing;
    setRemoving(null);
    try {
      await metaAdsService.remove(target.id);
      toast.success(`${target.name} removed`);
      await loadAccounts();
    } catch (err) {
      toast.error(apiMessage(err, 'Failed to remove the ad account'));
    }
  };

  const tokenLine = (a: MetaAdAccount) => {
    if (a.tokenType === 'system_user' || !a.tokenExpiresAt) return <span style={{ color: 'var(--ink-3)' }}>Never expires</span>;
    const expires = new Date(a.tokenExpiresAt);
    const soon = expires.getTime() - Date.now() <= WEEK_MS;
    return (
      <span style={{ color: soon ? 'var(--warn-ink)' : 'var(--ink-3)', fontWeight: soon ? 700 : undefined }}>
        Expires {format(expires, 'd MMM yyyy')}
      </span>
    );
  };

  const hasDisconnected = accounts.some((a) => a.status === 'disconnected');

  return (
    <>
      <Card title="Meta Ads" aside="Ad spend">
        <div style={{ padding: '12px 20px 20px', display: 'grid', gap: 14 }}>
          {connectError && (
            <div role="alert" className="opserr" style={{ margin: 0 }}>{connectError}</div>
          )}
          {loadError && <div role="alert" className="opserr" style={{ margin: 0 }}>{loadError}</div>}

          {loading ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading...</p>
          ) : accounts.length === 0 ? (
            <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
              <p style={{ color: 'var(--ink-2)', fontSize: 13 }}>
                CodAdmin reads your ad spend each day at 05:00. It never changes your ads.
              </p>
              {canUpdate && (
                <Button variant="primary" onClick={handleConnect} disabled={connecting}>
                  {connecting ? <Loader2 className="animate-spin" size={16} /> : <Link2 size={16} />}
                  Connect Meta Ads
                </Button>
              )}
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 10 }}>
                {accounts.map((a) => (
                  <div
                    key={a.id}
                    data-testid={`meta-account-${a.id}`}
                    style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <b style={{ fontSize: 14 }}>{a.name}</b>
                        <small style={{ display: 'block', color: 'var(--ink-3)', fontSize: 12 }}>
                          act_{a.accountId.replace(/^act_/, '')} · {a.currency}
                        </small>
                      </div>
                      {a.status === 'connected'
                        ? <Tag tone="ok">Connected</Tag>
                        : <Tag tone="bad">Disconnected{a.statusReason ? `: ${a.statusReason}` : ''}</Tag>}
                      {canUpdate && (
                        <button
                          type="button"
                          role="switch"
                          className="sw"
                          aria-checked={a.enabled}
                          aria-label={`Pull spend for ${a.name}`}
                          onClick={() => handleToggle(a)}
                        />
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, display: 'grid', gap: 2 }}>
                      <div>{tokenLine(a)}</div>
                      {a.lastPullError ? (
                        <div style={{ color: 'var(--coral)' }}>{a.lastPullError}</div>
                      ) : (
                        <div style={{ color: 'var(--ink-3)' }}>
                          {a.lastPulledAt
                            ? `Last pull ${formatDistanceToNow(new Date(a.lastPulledAt), { addSuffix: true })}`
                            : 'No pull yet'}
                        </div>
                      )}
                      {rowErrors[a.id] && <div role="alert" style={{ color: 'var(--coral)' }}>{rowErrors[a.id]}</div>}
                    </div>
                    {canUpdate && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button size="mini" onClick={() => handleRefresh(a)} disabled={refreshing === a.id}>
                          {refreshing === a.id ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                          Refresh now
                        </Button>
                        <Button size="mini" onClick={() => setRemoving(a)}>
                          <Trash2 size={14} /> Remove
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {canUpdate && hasDisconnected && (
                <div>
                  <Button variant="primary" onClick={handleConnect} disabled={connecting}>
                    {connecting ? <Loader2 className="animate-spin" size={16} /> : <Link2 size={16} />}
                    Reconnect Meta Ads
                  </Button>
                </div>
              )}
              <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                CodAdmin reads your ad spend each day at 05:00. It never changes your ads.
              </p>
            </>
          )}
        </div>
      </Card>

      {pickId && pickAccounts && (
        <MetaAdsPickerModal accounts={pickAccounts} onSave={handlePickSave} onClose={closePicker} saving={pickSaving} />
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={handleRemove}
        action="Remove"
        count={1}
        noun="ad account"
        title={removing ? `Remove ${removing.name}?` : undefined}
      >
        CodAdmin stops reading its spend. Spend already saved stays.
      </ConfirmDialog>
    </>
  );
};
