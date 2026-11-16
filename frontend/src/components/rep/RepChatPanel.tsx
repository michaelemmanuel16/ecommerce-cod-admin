import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, MessageCircle, X } from 'lucide-react';
import { EmptyState, Skeleton } from '../ui-v2';
import { messagesService, type OrderChat } from '../../services/messages.service';
import { useAuthStore } from '../../stores/authStore';
import { useWhatsappConnected } from '../../hooks/useWhatsappConnected';
import { ReplyBox } from '../../pages/messages/ReplyBox';
import { Thread } from '../../pages/messages/Thread';
import { initials } from '../../pages/messages/format';
import { productsService } from '../../services/products.service';
import { customersService } from '../../services/customers.service';
import type { InboxSubject } from '../../services/inbox.service';
import { ThreadPanel } from '../../pages/inbox/ThreadPanel';
import { formatOrderNumber } from '../../utils/orderNumber';
import type { ConversationRow } from '../../pages/messages/types';

export const WHATSAPP_OFF_HINT = 'WhatsApp is not connected';

type Target = { orderId: number } | { conversationId: number } | { notes: InboxSubject };

interface ChatApi {
  /** Open the chat of an order's customer (an empty chat when none exists yet). */
  openOrderChat: (orderId: number) => void;
  /** Open one conversation by id (an Inbox row). */
  openConversation: (id: number) => void;
  /** Open the team notes (comment thread) of an order. */
  openOrderNotes: (orderId: number) => void;
  /** Open the team notes of any subject: order, product, customer or payout. */
  openNotes: (subject: InboxSubject) => void;
}

// Outside the provider (a page rendered alone) the buttons do nothing; RepShell always provides it.
const ChatContext = createContext<ChatApi>({ openOrderChat: () => undefined, openConversation: () => undefined, openOrderNotes: () => undefined, openNotes: () => undefined });

export const useRepChat = (): ChatApi => useContext(ChatContext);

type Loaded = { kind: 'thread'; row: ConversationRow } | { kind: 'empty'; chat: OrderChat } | { kind: 'failed' } | null;

/** Empty chat: the first send creates the conversation, then the panel switches to it. */
function EmptyChat({ chat, disabledHint, onStarted }: { chat: OrderChat; disabledHint?: string; onStarted: (conversationId: number) => void }) {
  return (
    <>
      <div className="thhead">
        <div className="a avatar-dot">{initials(chat.customerName)}</div>
        <div>
          <b>{chat.customerName}</b>
          <small>{chat.phone} · WhatsApp</small>
        </div>
      </div>
      <div className="msgs" aria-label="Conversation messages">
        <EmptyState icon={<MessageCircle />} title="No messages yet" text="Send an approved template to start this chat. When the customer answers, you can type freely for 24 hours." />
      </div>
      <ReplyBox
        conversationId={0} windowOpen={false} onSent={() => undefined} disabledHint={disabledHint}
        send={async (payload) => { onStarted(await messagesService.start(chat.orderId, payload)); }}
      />
    </>
  );
}

const TYPE_LABEL: Record<string, string> = { order: 'Order', product: 'Product', customer: 'Customer', payout: 'Payout' };

/** "Order #12", "Product #3", "Payout #5": the title when a name cannot be had. */
const fallbackLabel = (s: InboxSubject): string => `${TYPE_LABEL[s.type] ?? 'Item'} ${formatOrderNumber(s.id)}`;

/** The name of a product or customer, fetched once (the rep may view both). Orders and payouts have no name to fetch. */
function useSubjectName(subject: InboxSubject): string | null {
  const [name, setName] = useState<string | null>(null);
  const { type, id } = subject;
  useEffect(() => {
    let live = true;
    setName(null);
    const set = (n: unknown) => { if (live && typeof n === 'string' && n.trim() && !/undefined|null/.test(n)) setName(n.trim()); };
    if (type === 'product') productsService.detail(id).then((p) => set(p?.name), () => undefined);
    else if (type === 'customer') customersService.getCustomerById(id).then((c) => set(c ? `${c.firstName ?? ''} ${c.lastName ?? ''}` : null), () => undefined);
    return () => { live = false; };
  }, [type, id]);
  return name;
}

/** The team notes of one subject, in the same drawer shell as the chat. */
function NotesPanel({ subject, onClose }: { subject: InboxSubject; onClose: () => void }) {
  const name = useSubjectName(subject);
  const label = subject.type === 'order' || !name ? fallbackLabel(subject) : name;
  return (
    <>
      <div className="rchat-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="rchat" role="dialog" aria-label="Team notes" data-testid="rep-notes-panel">
        <div className="rchat-head">
          <button type="button" className="ibtn" onClick={onClose} aria-label="Close team notes" data-testid="rep-chat-close">
            <ArrowLeft className="rchat-back" size={18} /><X className="rchat-x" size={18} />
          </button>
          <b>Team notes · {subject.type === 'order'
            ? <Link className="rchat-title-link" to={`/rep/call/${subject.id}`} onClick={onClose}>{label}</Link>
            : label}</b>
        </div>
        <div className="rchat-body rchat-notes">
          <ThreadPanel subject={subject} />
        </div>
      </aside>
    </>
  );
}

function ChatPanel({ target, onClose, onSwitch }: { target: Target; onClose: () => void; onSwitch: (id: number) => void }) {
  const meId = useAuthStore((s) => s.user?.id ?? null);
  const connected = useWhatsappConnected();
  const disabledHint = connected === false ? WHATSAPP_OFF_HINT : undefined;
  const [loaded, setLoaded] = useState<Loaded>(null);
  const orderId = 'orderId' in target ? target.orderId : null;
  const conversationId = 'conversationId' in target ? target.conversationId : null;

  useEffect(() => {
    let live = true;
    setLoaded(null);
    const fail = () => { if (live) setLoaded({ kind: 'failed' }); };
    const openRow = (id: number) => messagesService.getConversation(id).then((row) => { if (live) setLoaded({ kind: 'thread', row }); }, fail);
    if (conversationId) void openRow(conversationId);
    else if (orderId) {
      messagesService.forOrder(orderId).then((c) => {
        if (!live) return;
        if (c.conversationId) void openRow(c.conversationId); else setLoaded({ kind: 'empty', chat: c });
      }, fail);
    }
    return () => { live = false; };
  }, [orderId, conversationId]);

  return (
    <>
      <div className="rchat-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="rchat" role="dialog" aria-label="Customer chat" data-testid="rep-chat-panel">
        <div className="rchat-head">
          <button type="button" className="ibtn" onClick={onClose} aria-label="Close chat" data-testid="rep-chat-close">
            <ArrowLeft className="rchat-back" size={18} /><X className="rchat-x" size={18} />
          </button>
          <b>Chat</b>
        </div>
        <div className="inbox rchat-body">
          <div className="pane">
            {loaded === null && <div className="pad"><Skeleton height={120} /></div>}
            {loaded?.kind === 'failed' && <EmptyState icon={<MessageCircle />} title="This chat is not available" text="It is not one of yours, it has no phone number, or it no longer exists." />}
            {loaded?.kind === 'empty' && <EmptyChat chat={loaded.chat} disabledHint={disabledHint} onStarted={onSwitch} />}
            {loaded?.kind === 'thread' && (
              <Thread
                key={loaded.row.id} row={loaded.row} meId={meId} canWrite canPickPeople={false} canAssign={false}
                replyDisabledHint={disabledHint} orderLink={(id) => `/rep/call/${id}`}
                onChanged={(patch) => setLoaded((l) => (l?.kind === 'thread' ? { kind: 'thread', row: { ...l.row, ...patch } } : l))}
              />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

/** One chat panel for the whole rep app: the WhatsApp buttons and the Inbox open it over the current page. */
export function RepChatProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const { pathname } = useLocation();
  const close = useCallback(() => setTarget(null), []);
  const api = useMemo<ChatApi>(() => ({
    openOrderChat: (orderId) => setTarget({ orderId }),
    openConversation: (conversationId) => setTarget({ conversationId }),
    openOrderNotes: (id) => setTarget({ notes: { type: 'order', id } }),
    openNotes: (notes) => setTarget({ notes }),
  }), []);

  // Moving to another page (an "Order #n" link in the chat) leaves the chat behind
  useEffect(() => { setTarget(null); }, [pathname]);
  useEffect(() => {
    if (!target) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [target, close]);

  return (
    <ChatContext.Provider value={api}>
      {children}
      {target && 'notes' in target && <NotesPanel subject={target.notes} onClose={close} />}
      {target && !('notes' in target) && <ChatPanel target={target} onClose={close} onSwitch={(conversationId) => setTarget({ conversationId })} />}
    </ChatContext.Provider>
  );
}
