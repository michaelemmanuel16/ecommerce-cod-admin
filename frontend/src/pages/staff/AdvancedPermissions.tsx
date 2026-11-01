import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Button, Skeleton, Tag, useToast } from '../../components/ui-v2';
import { rolesService, type PermissionGrid, type RoleCard } from '../../services/roles.service';
import { apiMessage } from '../orders/importText';
import { BlockError } from '../dashboard/blocks/Frame';
import { useBlock } from '../financial/profit/useBlock';
import { actionLabel, fullAccess, readOnly, sameGrid, toggleCell } from './roleModel';

interface AdvancedPermissionsProps {
  role: RoleCard;
  /** Only the Owner saves a grid, and never the Owner's own. */
  editable: boolean;
  /** The grid was saved: the cards read the roles again (the tool switches follow the cells). */
  onChanged: () => void;
}

/**
 * "Advanced permissions" under the tool switches (M6-T21, F-1154): every cell of the permission matrix as a switch, by resource.
 * The tool switches are presets over these cells. The grid is read when the panel opens; Save writes it through
 * `PUT /api/roles/:id/permissions`, which clears the permission cache and tells the holders' browsers.
 */
export function AdvancedPermissions({ role, editable, onChanged }: AdvancedPermissionsProps) {
  const say = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [grid, setGrid] = useState<PermissionGrid | null>(null);
  const [busy, setBusy] = useState(false);
  const block = useBlock(`staff|permissions|${role.id}`, () => rolesService.permissions(role.id), open);
  const loaded = block.data;
  useEffect(() => { setGrid(loaded?.permissions ?? null); }, [loaded]);

  const locked = !editable || role.presetRole === 'super_admin';
  const dirty = !!loaded && !!grid && !sameGrid(grid, loaded.permissions);
  const resources = useMemo(
    () => Object.entries(loaded?.catalog ?? {}).filter(([resource]) => resource.includes(search.trim().toLowerCase())),
    [loaded, search],
  );

  const save = async () => {
    if (!grid) return;
    setBusy(true);
    try {
      await rolesService.savePermissions(role.id, grid);
      say(`${role.name} permissions saved`);
      block.retry();
      onChanged();
    } catch (err) {
      say(await apiMessage(err, 'The permissions could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card advperm">
      <button type="button" className="ct advperm-head" aria-expanded={open} aria-controls={`advperm-${role.id}`} onClick={() => setOpen((o) => !o)}>
        <h3>Advanced permissions</h3>
        <span>{(loaded?.custom || dirty) && <Tag tone="warn">Custom</Tag>}<ChevronDown aria-hidden="true" className={open ? 'up' : undefined} /></span>
      </button>
      {open && (
        <div className="advperm-body" id={`advperm-${role.id}`}>
          {block.status === 'failed' && !loaded ? (
            <BlockError name="The permissions" onRetry={block.retry} bare />
          ) : !loaded || !grid ? (
            <Skeleton height={160} />
          ) : (
            <>
              <p className="dsub">The tool switches above are presets over these cells. Change a cell and the role becomes Custom.</p>
              <div className="advperm-tools">
                <label className="staff-search">
                  <Search aria-hidden="true" />
                  <input type="search" aria-label="Search permissions" placeholder="Search a resource" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
                <Button size="mini" disabled={locked} onClick={() => setGrid(fullAccess(loaded.catalog))}>Full access</Button>
                <Button size="mini" disabled={locked} onClick={() => setGrid(readOnly(loaded.catalog))}>Read only</Button>
                <Button size="mini" disabled={locked || !dirty} onClick={() => setGrid(loaded.permissions)}>Reset to preset</Button>
              </div>
              <div className="advperm-grid" role="group" aria-label="Permission cells">
                {resources.length === 0 ? <small className="dsub">No resource matches.</small> : resources.map(([resource, actions]) => (
                  <div className="prow" key={resource}>
                    <b>{resource}</b>
                    <div className="pcells">
                      {actions.map((action) => (
                        <label className="sw pcell" key={action}>
                          <input
                            type="checkbox" role="switch" aria-label={`${resource} ${actionLabel(action)}`}
                            checked={(grid[resource] ?? []).includes(action)} disabled={locked || busy}
                            onChange={() => setGrid(toggleCell(grid, resource, action))}
                          />
                          <span className="tg" />
                          <span>{actionLabel(action)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {locked ? (
                <small className="dsub">{role.presetRole === 'super_admin' ? 'The Owner always has every permission.' : 'Only the Owner changes permissions.'}</small>
              ) : (
                <div className="advperm-save"><Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>Save permissions</Button></div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
