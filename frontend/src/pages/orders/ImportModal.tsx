import { useState, type DragEvent } from 'react';
import { Check, CheckCircle2, Download, FileSpreadsheet, UploadCloud, XCircle } from 'lucide-react';
import { Button, Modal, Tag } from '../../components/ui-v2';
import { ordersService, type ImportCheck, type ImportResult } from '../../services/orders.service';
import { apiMessage, MAX_FILE_BYTES, ordersPhrase, problemLine, rowsPhrase, saveText, TEMPLATE_HREF } from './importText';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  /** Some orders were made: the list should reload. */
  onImported: () => void;
  /** "Show the imported orders": the list opens on these ids. */
  onShow: (ids: number[]) => void;
}

type Stage =
  | { name: 'pick'; error?: string }
  | { name: 'checking'; file: File }
  | { name: 'checked'; file: File; check: ImportCheck }
  | { name: 'importing'; file: File; check: ImportCheck }
  | { name: 'done'; file: File; result: ImportResult };

const SHOWN_PROBLEMS = 5;

/**
 * The Import modal (M3-T48, F-319), built from docs/mockups/v2/index.html#m-import.
 * Step 1 checks the file and saves nothing; step 2 imports the ready rows; the result screen links to the new orders.
 */
export function ImportModal({ open, onClose, onImported, onShow }: ImportModalProps) {
  const [stage, setStage] = useState<Stage>({ name: 'pick' });
  const [over, setOver] = useState(false);
  // off by default, so imported orders send no customer messages (F-319)
  const [runWorkflows, setRunWorkflows] = useState(false);

  const close = () => {
    setStage({ name: 'pick' });
    setOver(false);
    setRunWorkflows(false);
    onClose();
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStage({ name: 'pick', error: 'That file is over 10 MB. Split it into parts.' });
      return;
    }
    setStage({ name: 'checking', file });
    try {
      setStage({ name: 'checked', file, check: await ordersService.checkImport(file) });
    } catch (err) {
      setStage({ name: 'pick', error: await apiMessage(err, 'The file could not be read. Check that it is a CSV or Excel file.') });
    }
  };

  const importReady = async () => {
    if (stage.name !== 'checked') return;
    const { file, check } = stage;
    setStage({ name: 'importing', file, check });
    try {
      const result = await ordersService.uploadOrders(file, runWorkflows);
      setStage({ name: 'done', file, result });
      onImported();
    } catch (err) {
      setStage({ name: 'pick', error: await apiMessage(err, 'The orders could not be imported. Nothing was changed. Try again.') });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void pick(e.dataTransfer.files[0]);
  };

  const file = stage.name === 'pick' ? undefined : stage.file;
  const check = stage.name === 'checked' || stage.name === 'importing' ? stage.check : undefined;
  const busy = stage.name === 'checking' || stage.name === 'importing';

  if (stage.name === 'done') {
    const { results, needFix, problemsCsv, note } = stage.result;
    const failed = results.failed + needFix;
    const made = results.orderIds ?? [];
    return (
      <Modal
        open={open}
        onClose={close}
        title="Import orders"
        description="Upload a CSV or Excel file. One row per order line."
        footer={<Button variant="primary" onClick={close}>Close</Button>}
      >
        <div className="filebar">
          <div className="ic" style={{ background: 'var(--mint-soft)', color: 'var(--ok-ink)' }}><CheckCircle2 /></div>
          <div style={{ flex: 1 }}>
            <b>{stage.file.name}</b>
            <div className="hint" style={{ marginTop: 0 }}>{rowsPhrase(stage.result.total)} read.</div>
          </div>
          <Tag tone="ok">{results.success.toLocaleString('en-GB')} successful</Tag>
          {failed > 0 && <Tag tone="bad">{failed.toLocaleString('en-GB')} failed</Tag>}
          {results.duplicates > 0 && <Tag tone="warn">{results.duplicates.toLocaleString('en-GB')} {results.duplicates === 1 ? 'duplicate' : 'duplicates'}</Tag>}
        </div>
        <div className="hl" role="status">
          <b style={{ fontSize: 13 }}>
            {results.success > 0 ? `Imported ${ordersPhrase(results.success)}.` : 'No orders were imported.'}
          </b>
          <div className="hint" style={{ marginTop: 4 }}>
            Successful {results.success.toLocaleString('en-GB')}. Failed {failed.toLocaleString('en-GB')}. Duplicates {results.duplicates.toLocaleString('en-GB')}.
            {note ? ` ${note}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {made.length > 0 && (
              <Button variant="primary" onClick={() => { onShow(made); close(); }}>Show the imported orders</Button>
            )}
            {problemsCsv && (
              <Button onClick={() => saveText(problemsCsv, `${stage.file.name.replace(/\.[^.]+$/, '')}-problems.csv`)}>
                <Download />
                Download the rows to fix
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import orders"
      description="Upload a CSV or Excel file. One row per order line."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!check || check.ready === 0 || busy} onClick={() => void importReady()}>
            <Check />
            {stage.name === 'importing' ? 'Importing...' : `Import ${check ? ordersPhrase(check.ready) : 'orders'}`}
          </Button>
        </>
      }
    >
      <div className="filebar">
        <div className="ic" style={{ background: 'var(--pine-soft)', color: 'var(--pine)' }}><FileSpreadsheet /></div>
        <div style={{ flex: 1 }}>
          <b>Start from the template</b>
          <div className="hint" style={{ marginTop: 0 }}>Same columns the importer reads: customer, phone, address, state, product, quantity, price, status.</div>
        </div>
        <a className="btn" download="order_import_template.csv" href={TEMPLATE_HREF} style={{ textDecoration: 'none' }}>
          <Download />
          Download template
        </a>
      </div>

      <label
        className={over ? 'drop over' : 'drop'}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          aria-label="Choose a file to import"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = ''; // the same file can be chosen again after a fix
          }}
        />
        <UploadCloud />
        <b>Drop a .csv, .xlsx or .xls file here</b>
        <div className="hint">or <u>browse your computer</u>. Up to 2,000 rows.</div>
      </label>

      {stage.name === 'pick' && stage.error && (
        <div className="filebar" role="alert">
          <div className="ic" style={{ background: 'var(--coral-soft)', color: 'var(--coral)' }}><XCircle /></div>
          <div style={{ flex: 1 }}>{stage.error}</div>
        </div>
      )}

      {file && (
        <div className="filebar" aria-busy={busy}>
          <div className="ic" style={{ background: 'var(--mint-soft)', color: 'var(--ok-ink)' }}><CheckCircle2 /></div>
          <div style={{ flex: 1 }}>
            <b>{file.name}</b>
            <div className="hint" style={{ marginTop: 0 }}>
              {stage.name === 'checking' && 'Checking the file...'}
              {stage.name === 'importing' && 'Importing...'}
              {check && `${rowsPhrase(check.total)} read. ${check.ready.toLocaleString('en-GB')} ready to import.`}
            </div>
          </div>
          {check && <Tag tone="ok">{check.ready.toLocaleString('en-GB')} ready</Tag>}
          {check && check.needFix > 0 && <Tag tone="bad">{check.needFix.toLocaleString('en-GB')} need a fix</Tag>}
        </div>
      )}

      {check && check.needFix > 0 && (
        <div className="hl">
          <b style={{ fontSize: 13 }}>{check.needFix === 1 ? '1 row needs a fix' : `${check.needFix.toLocaleString('en-GB')} rows need a fix`}</b>
          <div className="hint" style={{ marginTop: 4 }}>
            {check.problems.slice(0, SHOWN_PROBLEMS).map((p) => (
              <div key={p.row}>{problemLine(p)}</div>
            ))}
            {check.problems.length > SHOWN_PROBLEMS && <div>and {check.problems.length - SHOWN_PROBLEMS} more.</div>}
            <div style={{ marginTop: 6 }}>
              Fix them in the file and upload again, or import the {check.ready.toLocaleString('en-GB')} ready {check.ready === 1 ? 'row' : 'rows'} now.
            </div>
          </div>
          {check.problemsCsv && (
            <div style={{ marginTop: 10 }}>
              <Button onClick={() => saveText(check.problemsCsv!, `${file?.name.replace(/\.[^.]+$/, '')}-problems.csv`)}>
                <Download />
                Download the rows to fix
              </Button>
            </div>
          )}
        </div>
      )}
      {check && check.note && <div className="hint">{check.note}</div>}
      {check && (
        <div>
          <label className="chk">
            <input type="checkbox" checked={runWorkflows} disabled={busy} onChange={(e) => setRunWorkflows(e.target.checked)} />
            Run workflows for these orders
          </label>
          <div className="hint">Off by default, so imported orders send no customer messages.</div>
        </div>
      )}
      {check && check.duplicates > 0 && (
        <div className="hint">{check.duplicates.toLocaleString('en-GB')} {check.duplicates === 1 ? 'row matches' : 'rows match'} orders you already have.</div>
      )}
    </Modal>
  );
}
