import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Input, useToast } from '../../components/ui-v2';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { rolesService, type AssignResult, type RoleCard } from '../../services/roles.service';
import { apiMessage } from '../orders/importText';

export type AssignKind = 'ai_agent' | 'company';

interface AssignBoxProps {
  role: RoleCard;
  kind: AssignKind;
  onClose: () => void;
  /** A holder was added: the cards and the table ask again. */
  onAssigned: () => void;
}

const COPY = {
  ai_agent: { label: 'Agent name', placeholder: 'e.g. Stock-count agent', action: 'Create MCP key', failed: 'The AI agent could not be connected.' },
  company: { label: 'Company name', placeholder: 'e.g. a 3PL or agency', action: 'Add company', failed: 'The company could not be added.' },
} as const;

/**
 * The box under the role name for "Connect an AI agent" and "Add a company" (the mockup's .assignbox). The API's refusal shows
 * under the name (an AI agent cannot be given the Owner role). The MCP key of an agent shows in this box once, with Copy.
 */
export function AssignBox({ role, kind, onClose, onAssigned }: AssignBoxProps) {
  const say = useToast();
  const { copied, copy } = useCopyToClipboard();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<AssignResult | null>(null);
  const text = COPY[kind];

  const submit = async () => {
    if (!name.trim()) { setError(`Enter a ${kind === 'ai_agent' ? 'name for the agent' : 'company name'}`); return; }
    setBusy(true);
    setError(undefined);
    try {
      const result = await rolesService.assign(role.id, { type: kind, name: name.trim() });
      onAssigned();
      if (result.apiKey) setCreated(result);
      else { say(`${result.holder.name} added to ${role.name}`); onClose(); }
    } catch (err) {
      setError(await apiMessage(err, text.failed));
    } finally {
      setBusy(false);
    }
  };

  if (created?.apiKey) {
    return (
      <div className="assignbox" role="group" aria-label={`MCP key for ${created.holder.name}`}>
        <p><b>{created.holder.name}</b> is connected to {role.name}. Copy the key now. It is shown only once.</p>
        <div className="line">
          <input className="keyrow" readOnly aria-label="MCP key" value={created.apiKey.key} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="primary" onClick={() => void copy(created.apiKey!.key)}>{copied ? 'Copied' : 'Copy key'}</Button>
          <Button onClick={onClose}>Done</Button>
        </div>
        <div className="done-note"><CheckCircle2 aria-hidden="true" />The key can only use the {created.apiKey.toolCount} tools switched on for {role.name}.</div>
      </div>
    );
  }

  return (
    <form className="assignbox" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p>
        <b>{kind === 'ai_agent' ? `Connect an AI agent to ${role.name}` : `Add a company to ${role.name}`}</b>
        {kind === 'ai_agent' && <><br />The key can only use the {role.toolCount} tools switched on for this role.</>}
      </p>
      <div className="line">
        <Input label={text.label} value={name} onChange={(e) => setName(e.target.value)} placeholder={text.placeholder} error={error} autoFocus />
        <Button variant="primary" type="submit" disabled={busy}>{text.action}</Button>
        <Button type="button" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
