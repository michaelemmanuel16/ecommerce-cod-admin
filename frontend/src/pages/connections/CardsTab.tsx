import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CreditCard, Download, FileSpreadsheet, Mail, MessageCircle, Smartphone, ShoppingCart } from 'lucide-react';
import { Button, Skeleton, Tag, useToast } from '../../components/ui-v2';
import { MetaAdsIntegration } from '../../components/settings/integrations/MetaAdsIntegration';
import { McpIntegration } from '../../components/settings/integrations/McpIntegration';
import { usePermissions } from '../../hooks/usePermissions';
import { adminService, type SystemConfig, type WABAPhoneNumber } from '../../services/admin.service';
import { connectionsService, type ConnectionCards, type PaymentConnection } from '../../services/connections.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatRelativeTime } from '../../utils/format';
import { EmailDialog } from './EmailDialog';
import { PaystackDialog } from './PaystackDialog';
import { ConnCard, CopyButton } from './parts';
import { SmsDialog } from './SmsDialog';
import { WhatsAppDialog, WhatsAppPhonePicker } from './WhatsAppDialog';

type Dialog = 'sms' | 'whatsapp' | 'email' | 'paystack' | null;

const ago = (iso: string | null) => (iso ? formatRelativeTime(iso) : 'Never');
const EMAIL_NAMES: Record<string, string> = { platform: 'CodAdmin sender (Resend)', sendgrid: 'SendGrid', resend: 'Resend', smtp: 'SMTP' };

/** Connections tab (M9-T44): one card per connection, from GET /api/connections. The owner edits SMS, WhatsApp and Email; the owner and admins edit Paystack. */
export function CardsTab() {
  const say = useToast();
  const [params, setParams] = useSearchParams();
  const { can, isSuperAdmin, isAdmin } = usePermissions();
  const [cards, setCards] = useState<ConnectionCards | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [paystack, setPaystack] = useState<PaymentConnection | null>(null);
  const [reportUrl, setReportUrl] = useState<{ url: string | null; message?: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phones, setPhones] = useState<WABAPhoneNumber[] | null>(null);

  const loadCards = useCallback(async () => {
    try {
      setCards(await connectionsService.getCards());
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'The connections could not load.'));
    }
  }, []);
  const loadConfig = useCallback(async () => {
    if (!isSuperAdmin) return;
    try { setConfig(await adminService.getSystemConfig()); } catch { setConfig(null); }
  }, [isSuperAdmin]);
  const loadPaystack = useCallback(async () => {
    if (!isAdmin) return;
    try { setPaystack((await connectionsService.getPaymentConnections()).find((c) => c.provider === 'paystack') ?? null); } catch { setPaystack(null); }
  }, [isAdmin]);
  const reload = useCallback(() => Promise.all([loadCards(), loadConfig(), loadPaystack()]), [loadCards, loadConfig, loadPaystack]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!isAdmin) return;
    connectionsService.getSmsReportUrl().then(setReportUrl).catch(() => setReportUrl(null));
  }, [isAdmin]);

  // Meta sends the browser back here after the WhatsApp login: ?oauth=success, ?oauth=error&message=, or ?error=start_again
  // when the login state was lost. Read it once, then clear it.
  useEffect(() => {
    const oauth = params.get('oauth');
    const error = params.get('error');
    if (!oauth && !error) return;
    const next = new URLSearchParams(params);
    ['oauth', 'error', 'message'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
    if (error === 'start_again') { setNotice('The login expired. Start again.'); return; }
    if (oauth === 'error') { setNotice(params.get('message') || 'The Meta login failed. Start again.'); return; }
    if (oauth === 'success') void afterMetaLogin();
  }, []);

  const connectPhone = async (phone: WABAPhoneNumber) => {
    try {
      await adminService.selectWhatsAppOAuthPhone({ phoneNumberId: phone.id, displayPhone: phone.display_phone_number, verifiedName: phone.verified_name });
      say(`WhatsApp connected: ${phone.verified_name}`);
      setPhones(null);
      await reload();
    } catch (e) {
      setNotice(apiErrorMessage(e, 'The number could not be saved. Start again.'));
      setPhones(null);
    }
  };

  async function afterMetaLogin() {
    try {
      const { phones: found } = await adminService.getWhatsAppOAuthPhones();
      if (found.length === 0) setNotice('Meta found no WhatsApp number on your business account.');
      else if (found.length === 1) await connectPhone(found[0]);
      else setPhones(found);
    } catch (e) {
      setNotice(apiErrorMessage(e, 'The login expired. Start again.'));
    }
  }

  const retry = async (key: 'sms' | 'whatsapp' | 'email' | 'paystack') => {
    setRetrying(key);
    try {
      if (key === 'whatsapp') {
        const s = await adminService.getWhatsAppStatus();
        say(s.error ? s.error : 'WhatsApp answered. Checked again.');
      } else if (key === 'paystack' && paystack?.id) {
        say((await connectionsService.testPaymentConnection(paystack.id)).message);
      } else {
        say('Checked again');
      }
    } catch (e) {
      say(apiErrorMessage(e, 'The check failed.'));
    } finally {
      await reload();
      setRetrying(null);
    }
  };

  const downloadTemplate = async () => {
    try {
      const url = URL.createObjectURL(await connectionsService.getCsvTemplate());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'partner-status-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      say(apiErrorMessage(e, 'The template could not be downloaded.'));
    }
  };

  if (failed) return <div className="opserr top" role="alert">{failed} <Button size="mini" onClick={loadCards}>Retry</Button></div>;
  if (!cards) return <div aria-busy="true" aria-label="Loading connections"><Skeleton height={200} className="skelcard" /></div>;

  const wa = config?.whatsappProvider;
  const sms = config?.smsProvider;
  const emailFrom = config?.emailProvider?.fromEmail;
  const slug = config?.tenantSlug;
  const paystackHook = slug ? `${window.location.origin}/api/paystack/webhook/${slug}` : null;
  const owner = (label: string, on: () => void) => (isSuperAdmin ? <Button variant="primary" onClick={on}>{label}</Button> : null);

  return (
    <>
      {notice && (
        <div className="strip bad" role="alert" style={{ marginBottom: 16, alignItems: 'center' }}>
          <AlertTriangle aria-hidden="true" />
          <span style={{ flex: 1 }}>{notice}</span>
          {isSuperAdmin && <Button size="mini" onClick={() => { setNotice(null); setDialog('whatsapp'); }}>Start again</Button>}
          <Button size="mini" onClick={() => setNotice(null)}>Dismiss</Button>
        </div>
      )}
      <div className="conns">
        <ConnCard
          icon={Smartphone} tone="mint" title="Arkesel SMS" sub="Text messages to customers" card={cards.sms}
          rows={[['Sender ID', sms?.senderId || 'Not set'], ['API key', sms?.authToken ? '••••••••' : 'Not set'], ['Last activity', ago(cards.sms.lastEventAt)]]}
          onRetry={() => retry('sms')} retrying={retrying === 'sms'}
        >
          {owner(cards.sms.status === 'not_connected' ? 'Connect' : 'Edit', () => setDialog('sms'))}
          {reportUrl?.url && (
            <div className="urlrow" style={{ flexBasis: '100%' }}>
              <span className="mono" title={reportUrl.url}>{reportUrl.url}</span><CopyButton text={reportUrl.url} label="Copy report URL" />
            </div>
          )}
          {reportUrl && !reportUrl.url && reportUrl.message && <p className="cn-off" style={{ flexBasis: '100%' }}>{reportUrl.message}</p>}
        </ConnCard>

        <ConnCard
          icon={MessageCircle} tone="mint" title="WhatsApp Business" sub="Reminders and replies" card={cards.whatsapp}
          rows={[
            ['Phone number', wa?.oauthDisplayPhone || 'Not set'], ['Business', wa?.oauthVerifiedName || 'Not set'],
            ['Connected by', wa?.authMode === 'oauth' ? 'Meta login' : wa?.accessToken ? 'Token' : 'Not set'],
            ...(wa?.oauthTokenExpiry ? [['Token ends', new Date(wa.oauthTokenExpiry).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })] as [string, string]] : []),
          ]}
          onRetry={() => retry('whatsapp')} retrying={retrying === 'whatsapp'}
        >
          {owner(cards.whatsapp.status === 'not_connected' ? 'Connect' : cards.whatsapp.status === 'error' ? 'Reconnect' : 'Edit', () => setDialog('whatsapp'))}
        </ConnCard>

        <ConnCard
          icon={Mail} tone="violet" title="Email" sub="Receipts, guides and campaigns" card={cards.email}
          rows={[['Sender', EMAIL_NAMES[cards.email.provider ?? ''] ?? 'Not set'], ...(emailFrom ? [['From', emailFrom] as [string, string]] : []), ['Last activity', ago(cards.email.lastEventAt)]]}
          onRetry={() => retry('email')} retrying={retrying === 'email'}
        >
          {owner('Edit', () => setDialog('email'))}
        </ConnCard>

        <ConnCard
          icon={CreditCard} tone="pine" title="Paystack" sub="Card and MoMo payments" card={cards.paystack}
          testMode={cards.paystack.status === 'connected' && cards.paystack.mode === 'test'}
          rows={[['Mode', cards.paystack.mode === 'live' ? 'Live' : cards.paystack.mode === 'test' ? 'Test' : 'Not set'], ['Public key', paystack?.publicKey || 'Not set']]}
          onRetry={() => retry('paystack')} retrying={retrying === 'paystack'}
        >
          {isAdmin && <Button variant="primary" onClick={() => setDialog('paystack')}>{cards.paystack.status === 'not_connected' ? 'Add keys' : 'Edit keys'}</Button>}
          {paystackHook && <CopyButton text={paystackHook} label="Copy webhook URL" />}
        </ConnCard>

        {can('marketing', 'view') && <div className="wide"><MetaAdsIntegration /></div>}

        <ConnCard
          icon={ShoppingCart} tone="pine" title="Checkout website" sub="Orders from your checkout forms" card={cards.checkout}
          rows={[['Forms', String(cards.checkout.forms)], ['Last order', ago(cards.checkout.lastOrderAt)]]}
        >
          <Link className="btn pri" to="/checkout-forms">Open Checkout forms</Link>
        </ConnCard>

        <ConnCard
          icon={FileSpreadsheet} tone="plain" title="CSV upload" sub="For 3PLs and riders without a dashboard" card={cards.csv} tag={<Tag>Manual</Tag>}
          rows={[['Matches by', 'Order number or phone'], ['Columns', 'Order, phone, status, date']]}
        >
          <Button onClick={downloadTemplate}><Download size={14} /> Download template</Button>
          <Link className="btn" to="/delivery-agents">Open Deliveries</Link>
        </ConnCard>

        {isSuperAdmin && (
          <div className="wide setold legacy-light" style={{ borderRadius: 18 }}>
            <McpIntegration />
          </div>
        )}
      </div>

      <SmsDialog open={dialog === 'sms'} config={config} onClose={() => setDialog(null)} onSaved={reload} />
      <WhatsAppDialog open={dialog === 'whatsapp'} config={config} onClose={() => setDialog(null)} onSaved={reload} />
      <EmailDialog open={dialog === 'email'} config={config} onClose={() => setDialog(null)} onSaved={reload} />
      <PaystackDialog open={dialog === 'paystack'} connection={paystack} webhookUrl={paystackHook} onClose={() => setDialog(null)} onSaved={reload} />
      <WhatsAppPhonePicker phones={phones} onPick={connectPhone} onClose={() => setPhones(null)} />
    </>
  );
}
