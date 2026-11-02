import { useEffect, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { rolesService, type RoleCard, type RoleTool } from '../../services/roles.service';
import { apiMessage } from '../orders/importText';
import { flipTool } from './roleModel';

interface ToolSwitchesProps {
  role: RoleCard;
  /** The Owner may flip the switches of any role but the Owner's own. */
  editable: boolean;
  /** A switch was saved: the cards read the roles again. */
  onChanged: () => void;
}

function Group({ label, icon: Icon, tools, on, locked, onFlip }: { label: string; icon: typeof Eye; tools: readonly RoleTool[]; on: ReadonlySet<string>; locked: boolean; onFlip: (key: string) => void }) {
  return (
    <div className="tgroup">
      <p><Icon aria-hidden="true" />{label}</p>
      <div className="tlist">
        {tools.map((t) => (
          <div className="trow" key={t.key}>
            <span>{t.label}</span>
            <label className="sw">
              <input type="checkbox" role="switch" aria-label={t.label} checked={on.has(t.key)} disabled={locked} onChange={() => onFlip(t.key)} />
              <span className="tg" />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The 16 tool switches of a role, 7 read and 9 write (M6-T21, F-1153), as docs/mockups/v2/staff.html draws them. A flip saves at once
 * through `PUT /api/roles/:id/tools`; the API refuses a write tool whose read tool is off ("Needs View orders") and the switch stays
 * where it was, with the words of the API under the list. The Owner's switches are locked.
 */
export function ToolSwitches({ role, editable, onChanged }: ToolSwitchesProps) {
  const owner = role.presetRole === 'super_admin';
  const [on, setOn] = useState<string[]>(role.tools);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = role.tools.join(',');
  useEffect(() => { setOn(saved ? saved.split(',') : []); setError(null); }, [role.id, saved]);

  const flip = async (key: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await rolesService.setTools(role.id, flipTool(on, key, role.toolCatalog));
      setOn(next.tools);
      onChanged();
    } catch (err) {
      setError(await apiMessage(err, 'The tools could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const locked = owner || !editable || busy;
  const set = new Set(on);
  return (
    <>
      <h4><span>Allowed tools</span><span>{on.length} of {role.toolTotal} on</span></h4>
      <Group label="Read" icon={Eye} tools={role.toolCatalog.filter((t) => t.kind === 'read')} on={set} locked={locked} onFlip={(k) => void flip(k)} />
      <Group label="Write" icon={Pencil} tools={role.toolCatalog.filter((t) => t.kind === 'write')} on={set} locked={locked} onFlip={(k) => void flip(k)} />
      {error && <p className="err" role="alert">{error}</p>}
    </>
  );
}
