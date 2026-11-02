import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Gift, Pencil } from 'lucide-react';
import { Button, Card, useToast } from '../../components/ui-v2';
import { todayYmd } from '../../utils/format';
import { compactMoney } from '../dashboard/format';
import { apiMessage } from '../orders/importText';
import { NorthStarFields } from '../northStar/NorthStarFields';
import { PAST_MONTHS_NOTE, quarterChanges } from '../northStar/model';
import { useNorthStarDraft } from '../northStar/useNorthStarDraft';

/**
 * Settings, North Star and targets (M6-T17, F-1112, F-1114): the inputs of the North Star, the split with its months, the drivers and
 * the calculator tiles. Everyone who may see Targets sees it; the Owner edits. A save shows what it will change first. It shows no
 * reward tiers: one line sends the person to Rewards (S1).
 */
export function NorthStarTab({ editable }: { editable: boolean }) {
  const say = useToast();
  const navigate = useNavigate();
  const draft = useNorthStarDraft(Number(todayYmd().slice(0, 4)));
  const [confirming, setConfirming] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changes = draft.preview && draft.saved ? quarterChanges(draft.saved.quarters.map((q) => q.value), draft.preview.quarters) : [];

  const ask = () => {
    setTried(true);
    setError(null);
    setConfirming(draft.problems.length === 0);
  };
  const confirm = async () => {
    setBusy(true);
    try {
      await draft.save();
      say('North Star saved');
      setConfirming(false);
      setTried(false);
      draft.reload();
    } catch (err) {
      setError(await apiMessage(err, 'The North Star could not be saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card
        title="North Star & targets"
        aside={editable && <Button onClick={() => navigate('/onboarding?step=3')}><Pencil aria-hidden="true" />Edit in setup</Button>}
      >
        <div style={{ padding: '14px 20px 20px' }}>
          {draft.loadError && <p className="nsgap" role="alert">{draft.loadError}</p>}
          {!draft.loaded && !draft.loadError && <p>Loading your North Star...</p>}
          {draft.loaded && (
            <>
              {!editable && <p className="setnote">You can view this section but not change it. The owner edits the North Star.</p>}
              <NorthStarFields draft={draft} editable={editable} tiles="four" />
              {editable && tried && draft.problems.length > 0 && (
                <ul className="nsgap" role="alert" style={{ marginTop: 14, paddingLeft: 18 }}>{draft.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
              {editable && confirming && (
                <div className="nsconfirm" role="group" aria-label="Confirm the new targets" style={{ marginTop: 14 }}>
                  <span>Saving recalculates the 12 monthly targets. {PAST_MONTHS_NOTE}</span>
                  {changes.length > 0 && (
                    <ul>{changes.map((c) => <li key={c.quarter}>Q{c.quarter}: {compactMoney(c.from, draft.currency)} to {compactMoney(c.to, draft.currency)}</li>)}</ul>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="primary" disabled={busy} onClick={confirm}>{busy ? 'Saving...' : 'Confirm and save'}</Button>
                    <Button disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              {error && <p className="nsgap" role="alert" style={{ marginTop: 10 }}>{error}</p>}
              {editable && !confirming && <div style={{ marginTop: 16 }}><Button variant="primary" onClick={ask}>Save targets</Button></div>}
            </>
          )}
        </div>
      </Card>
      <Card>
        <div className="nsrewards" style={{ padding: '14px 20px' }}>
          <Gift aria-hidden="true" />
          <b>Rewards are set in Rewards.</b>
          <Link className="btn" to="/settings?tab=rewards">Open Rewards</Link>
        </div>
      </Card>
    </>
  );
}
