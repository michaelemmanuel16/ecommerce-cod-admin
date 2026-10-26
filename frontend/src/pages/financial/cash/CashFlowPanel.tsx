import { useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Banknote, CheckCircle2, Download, Flag, HandCoins, Hourglass, Truck, Wallet } from 'lucide-react';
import { Button, Card, Tag, Tile, useToast } from '../../../components/ui-v2';
import { financeReportsService, type CashFlowForecastReport, type Scenario } from '../../../services/financeReports.service';
import { parseMoney } from '../../../utils/money';
import { apiMessage, saveBlob } from '../../orders/importText';
import { shortDay } from '../../dashboard/format';
import { cost, lossClass, money } from '../profit/format';
import { Part } from '../profit/Part';
import { useBlock } from '../profit/useBlock';
import { assumptions, cashFinding, scenarioLabels } from './copy';
import { ForecastChart } from './charts';
import { TrendCard } from './TrendCard';

const STATUS = { safe: { tone: 'ok', text: 'Safe' }, tight: { tone: 'warn', text: 'Tight' }, runs_out: { tone: 'bad', text: 'Runs out' } } as const;

/**
 * The cash flow tab (F-928, F-929, M5-T41). Each unit of money sits in one bucket: cash at bank and MoMo (1010) and cash with
 * partners (1015) add up to the cash total; what orders out for delivery will bring is shown apart as expected, never added.
 * The scenario switch asks the server again; the figures, the chart, the weeks and the words all come from its answer.
 */
export function CashFlowPanel() {
  const [scenario, setScenario] = useState<Scenario>('pace');
  const block = useBlock(`cash|${scenario}`, () => financeReportsService.cashFlow(scenario));
  const say = useToast();
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await financeReportsService.exportFile('cash-flow', { format: 'csv', scenario });
      saveBlob(blob, filename);
      say(`Downloaded ${filename}`);
    } catch (err) {
      say(await apiMessage(err, 'The forecast could not be exported. Try again.'));
    } finally {
      setExporting(false);
    }
  };

  const labels = scenarioLabels(block.data?.scenario);

  return (
    <div className="fin">
      <div className="fchead">
        <div className="seg" role="group" aria-label="Forecast pace">
          {(['pace', 'target'] as const).map((key) => (
            <button key={key} type="button" className={key === scenario ? 'on' : undefined} aria-pressed={key === scenario} onClick={() => setScenario(key)}>
              {labels[key]}
            </button>
          ))}
        </div>
        <Button className="fcexport" onClick={() => void exportCsv()} disabled={exporting}><Download />Export CSV</Button>
      </div>

      <Part name="Cash flow" block={block} height={420}>
        {(r) => <Forecast r={r} />}
      </Part>

      <TrendCard />
    </div>
  );
}

function Forecast({ r }: { r: CashFlowForecastReport }) {
  const { kpis, summary } = r;
  const status = STATUS[summary.status];
  const finding = cashFinding(r);
  const points = r.forecast.map((d) => ({ date: d.date, balance: parseMoney(d.projectedBalance) }));
  return (
    <div className="fin">
      <div className="grid kpis">
        <Tile icon={<Wallet />} tone="pine" value={money(kpis.cashInHand)} label="Cash at bank and MoMo" footer={<><span>Account 1010</span><Tag>Cash</Tag></>} />
        <Tile icon={<HandCoins />} tone="gold" value={money(kpis.cashInTransit)} label="Cash with delivery partners" footer={<><span>Account 1015, after their fees</span><Tag>Cash</Tag></>} />
        <Tile icon={<Banknote />} tone="mint" value={money(kpis.totalCashPosition)} label="Cash in total" footer={<span>Bank and MoMo plus partners</span>} />
        <Tile icon={<Truck />} tone="violet" value={money(kpis.cashExpected)} label="Expected, out for delivery" footer={<><span>Not cash until delivered and paid</span><Tag tone="warn">Expected</Tag></>} />
      </div>

      <div className="grid kpis three">
        <Tile icon={<ArrowDownToLine />} tone="mint" value={money(summary.expectedIn)} label="Expected in, 30 days" footer={<><span>Partner payouts and new deliveries</span><Tag>Forecast</Tag></>} />
        <Tile icon={<ArrowUpFromLine />} tone="coral" value={money(summary.expectedOut)} label="Expected out, 30 days" footer={<><span>Expenses and supplier payables</span><Tag>Forecast</Tag></>} />
        <Tile
          icon={<Flag />} tone="gold"
          value={<span className={lossClass(summary.endBalance)}>{money(summary.endBalance)}</span>}
          label={`Cash on ${shortDay(summary.endDate)}`}
          footer={<><span>Lowest {money(summary.lowest.balance)} on {shortDay(summary.lowest.date)}</span><Tag tone={status.tone}>{status.text}</Tag></>}
        />
      </div>

      <div className="grid two">
        <Card title="Cash balance, next 30 days" aside={`${shortDay(r.forecast[0]?.date ?? summary.endDate)} to ${shortDay(summary.endDate)}`}>
          <div className="lgrow"><span><i style={{ background: 'var(--pine)' }} />Cash balance</span><span><i className="dash" />Zero</span></div>
          <ForecastChart points={points} summary={`Forecast cash balance for 30 days, ending ${money(summary.endBalance)}`} />
        </Card>
        <Card title="What the forecast says" aside="From the server">
          <div className="insight finding">
            <div className="h">
              <div className={`ico ${finding.tone === 'bad' ? 'coral' : finding.tone === 'warn' ? 'gold' : 'mint'}`}>{finding.tone === 'bad' ? <AlertTriangle /> : finding.tone === 'warn' ? <Hourglass /> : <CheckCircle2 />}</div>
              <div><b>{finding.title}</b><p>{finding.body}</p></div>
            </div>
          </div>
          <div className="assume">
            <b>What the forecast assumes</b>
            {assumptions(r).map((line) => <p key={line}>{line}</p>)}
          </div>
        </Card>
      </div>

      <Card title="Week by week" aside="In the store currency" className="fincard">
        <div className="tablewrap">
          <table className="dt" aria-label="Week by week">
            <thead>
              <tr><th>Week</th><th className="r">Money in</th><th className="r">Money out</th><th className="r">Net</th><th className="r">Cash at end</th></tr>
            </thead>
            <tbody>
              {r.weeks.map((w) => (
                <tr key={w.from}>
                  <td>{shortDay(w.from)} to {shortDay(w.to)}</td>
                  <td className="r num">{money(w.moneyIn)}</td>
                  <td className="r num">{cost(w.moneyOut)}</td>
                  <td className={`r num ${lossClass(w.net) ?? ''}`}>{money(w.net)}</td>
                  <td className={`r num ${lossClass(w.cashAtEnd) ?? ''}`}><b>{money(w.cashAtEnd)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

