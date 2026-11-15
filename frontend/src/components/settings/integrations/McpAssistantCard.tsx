import React, { useCallback, useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import api from '../../../services/api';
import { ConnCard, ConnDetail } from '../../../pages/connections/parts';
import type { ConnectionCard } from '../../../services/connections.service';
import { formatRelativeTime } from '../../../utils/format';
import { McpIntegration, type McpApiKey } from './McpIntegration';

/** The AI Assistant card of the Connections grid: key count and last use on the card, the key list and Generate key in its modal. */
export const McpAssistantCard: React.FC = () => {
  const [keys, setKeys] = useState<McpApiKey[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    api.get('/api/mcp-keys').then((res) => { if (live) setKeys(res.data.keys); }).catch(() => { if (live) setKeys([]); });
    return () => { live = false; };
  }, []);
  const onKeysChange = useCallback((next: McpApiKey[]) => setKeys(next), []);

  const list = keys ?? [];
  const lastUsed = list.reduce<string | null>((best, k) => (k.lastUsedAt && (!best || k.lastUsedAt > best) ? k.lastUsedAt : best), null);
  const card: ConnectionCard = list.length > 0
    ? { status: 'connected', reason: null, lastEventAt: lastUsed }
    : { status: 'not_connected', reason: null, lastEventAt: null };

  return (
    <>
      <ConnCard
        icon={Bot} tone="violet" title="AI Assistant" sub="Ask your data in plain words" card={card}
        rows={[['Keys', keys === null ? '...' : String(list.length)], ['Last used', lastUsed ? formatRelativeTime(lastUsed) : 'Never']]}
        onOpen={() => setOpen(true)}
      />
      <ConnDetail
        open={open} onClose={() => setOpen(false)} icon={Bot} tone="violet" title="AI Assistant" sub="Ask your data in plain words" card={card}
        actions={<></>}
      >
        <div className="legacy-light" style={{ borderRadius: 18, margin: '0 -4px' }}>
          <McpIntegration onKeysChange={onKeysChange} />
        </div>
      </ConnDetail>
    </>
  );
};
