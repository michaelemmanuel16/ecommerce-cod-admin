import { useState } from 'react';
import { Button } from '../../components/ui-v2';
import { apiMessage } from '../orders/importText';
import { NorthStarFields } from './NorthStarFields';
import { useNorthStarDraft } from './useNorthStarDraft';

interface Props {
  year: number;
  onBack: () => void;
  onSaved: () => void;
}

/** Step 3, Set your North Star (F-1111): the shared fields, then "Save and set driver targets" writes the tree and the drivers. */
export function StepNorthStar({ year, onBack, onSaved }: Props) {
  const draft = useNorthStarDraft(year);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setTried(true);
    setError(null);
    if (draft.problems.length > 0) return;
    setBusy(true);
    try {
      await draft.save();
      onSaved();
    } catch (err) {
      setError(await apiMessage(err, 'The North Star could not be saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>What is your goal for {draft.year}?</h2>
      <p>Enter the delivered revenue you want this year. We split it into quarterly and monthly targets. You can change the split.</p>
      {draft.loadError && <div className="authnote bad" role="alert" style={{ marginBottom: 14 }}>{draft.loadError}</div>}
      {!draft.loaded && !draft.loadError && <p>Loading your North Star...</p>}
      {draft.loaded && <NorthStarFields draft={draft} editable />}
      {tried && draft.problems.length > 0 && (
        <ul className="nsgap" role="alert" style={{ marginTop: 14, paddingLeft: 18 }}>{draft.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {error && <div className="authnote bad" role="alert" style={{ marginTop: 14 }}>{error}</div>}
      <div className="wfoot">
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" disabled={!draft.loaded || busy} onClick={save}>{busy ? 'Saving...' : 'Save and set driver targets'}</Button>
      </div>
    </div>
  );
}
