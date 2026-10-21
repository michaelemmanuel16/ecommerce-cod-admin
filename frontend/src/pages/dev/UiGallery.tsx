import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Clock, Inbox, Moon, Phone, ShoppingCart, Sun, Truck, Wallet } from 'lucide-react';
import {
  Button, Card, Drawer, EmptyState, Input, Modal, Pagination, Select, Skeleton, Table, Tabs, Tag, Tile,
  ToastProvider, Tooltip, useToast, type Column,
} from '../../components/ui-v2';

// Dev-only page (route exists only when import.meta.env.DEV): every ui-v2 component in every variant.
// ?theme=dark starts in dark mode; ?open=modal|drawer|toast opens a layer so it can be screenshotted.

interface Row { id: number; order: string; customer: string; status: ReactNode; amount: string }
const rows: Row[] = [
  { id: 1, order: '#1042', customer: 'Abena Owusu', status: <Tag tone="ok">Delivered</Tag>, amount: 'GH₵249.00' },
  { id: 2, order: '#1043', customer: 'Kofi Mensah', status: <Tag tone="warn">Pending</Tag>, amount: 'GH₵449.00' },
  { id: 3, order: '#1044', customer: 'Esi Badu', status: <Tag tone="bad">Failed</Tag>, amount: 'GH₵629.00' },
];
const columns: Column<Row>[] = [
  { key: 'order', header: 'Order', render: (r) => <b>{r.order}</b> },
  { key: 'customer', header: 'Customer', render: (r) => r.customer },
  { key: 'status', header: 'Status', render: (r) => r.status },
  { key: 'amount', header: 'Amount', right: true, render: (r) => r.amount },
];
const tabItems = [{ id: 'all', label: 'All', count: '1,445' }, { id: 'pending', label: 'Pending', count: 64 }, { id: 'delivered', label: 'Delivered', count: 376 }, { id: 'failed', label: 'Failed' }];

const row: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function Body() {
  const params = new URLSearchParams(window.location.search);
  const open = params.get('open');
  const say = useToast();
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [tab, setTab] = useState('pending');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(open === 'modal');
  const [drawer, setDrawer] = useState(open === 'drawer');

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => {
    if (open === 'toast') say('Order #1042 saved');
  }, [open, say]);

  return (
    <div className="v2" style={{ minHeight: '100vh' }}>
      <div className="content">
        <div className="head">
          <div>
            <h1>Design system</h1>
            <p>Every ui-v2 component and variant. Dev only.</p>
          </div>
          <Button size="icon" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setDark(!dark)}>
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>

        <Section title="Button">
          <div style={row}>
            <Button>Export</Button>
            <Button variant="primary">New order</Button>
            <Button variant="danger">Delete</Button>
            <Button disabled>Disabled</Button>
            <Button size="mini">Dismiss</Button>
            <Button size="mini" variant="primary">Assign all 9 to Adwoa</Button>
            <Button size="icon" aria-label="Orders"><ShoppingCart /></Button>
            <Button size="icon-sm" aria-label="Phone"><Phone /></Button>
          </div>
        </Section>

        <Section title="Tag">
          <div style={row}>
            <Tag tone="ok">Delivered</Tag><Tag tone="bad">Failed</Tag><Tag tone="warn">Pending</Tag><Tag tone="v">Agent flag</Tag><Tag tone="n">Draft</Tag>
          </div>
        </Section>

        <Section title="Tile">
          <div className="grid kpis" style={{ marginTop: 0 }}>
            <Tile tone="pine" icon={<ShoppingCart />} value="64" label="Orders today" footer={<><span>Target 56</span><Tag tone="ok">▲ 18% vs last Fri</Tag></>} />
            <Tile tone="mint" icon={<Phone />} value="71%" label="Confirmation rate" footer={<><span>Target 70%</span><Tag tone="ok">On track</Tag></>} />
            <Tile tone="coral" icon={<Truck />} value="48%" label="Delivery success rate" footer={<><span>Target 60% · yield 34%</span><Tag tone="bad">▼ 12 pts</Tag></>} />
            <Tile tone="gold" icon={<Wallet />} value="GH₵23.4k" label="Cash with agents" footer={<><span>38 unpaid over 8 days</span><Tag tone="warn">Chase</Tag></>} />
            <Tile tone="violet" icon={<Clock />} value="4h" label="Oldest waiting order" />
          </div>
        </Section>

        <Section title="Card">
          <div className="grid two" style={{ marginTop: 0 }}>
            <Card title="Orders this month" aside="Updated 06:42"><div style={{ padding: '14px 20px 18px' }}>Card body text.</div></Card>
            <Card><div style={{ padding: 20 }}>A bare card.</div></Card>
          </div>
        </Section>

        <Section title="Tabs and Table">
          <Card>
            <Tabs label="Order status" items={tabItems} value={tab} onChange={setTab} />
            <Table label="Orders" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={() => setDrawer(true)} />
            <Pagination page={page} pageSize={10} total={1445} noun="orders" onPageChange={setPage} />
          </Card>
        </Section>

        <Section title="Input and Select">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
            <Input label="Customer name" placeholder="Abena Owusu" />
            <Input label="Email" optional hint="We send the receipt here" placeholder="abena@example.com" />
            <Input label="Phone" error="Enter a valid phone number" defaultValue="024" />
            <Select label="Region" hint="Used for delivery fees"><option>Greater Accra</option><option>Ashanti</option></Select>
            <Select label="Status" error="Pick a status"><option>Pending</option></Select>
            <div className="fl"><label htmlFor="g-compact">Compact select</label><Select compact label="Period" id="g-compact"><option>Today</option><option>This week</option><option>This month</option></Select></div>
          </div>
        </Section>

        <Section title="EmptyState and Skeleton">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <Card><EmptyState icon={<Inbox />} title="Nothing here" text="You are caught up." action={<Button variant="primary">Add order</Button>} /></Card>
            <Card><div aria-busy="true" style={{ padding: 20, display: 'grid', gap: 10 }}><Skeleton width="40%" height={18} /><Skeleton /><Skeleton width="80%" /><Skeleton height={44} /></div></Card>
          </div>
        </Section>

        <Section title="Tooltip, Toast, Modal, Drawer">
          <div style={row}>
            <Tooltip label="Confirmed orders divided by new orders"><Button>Hover or focus me</Button></Tooltip>
            <Button onClick={() => say('Order #1042 saved')}>Show toast</Button>
            <Button onClick={() => setModal(true)}>Open modal</Button>
            <Button onClick={() => setDrawer(true)}>Open drawer</Button>
          </div>
        </Section>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Import orders" description="Upload a CSV file. Max 5,000 rows."
        footer={<><Button onClick={() => setModal(false)}>Cancel</Button><Button variant="primary" onClick={() => setModal(false)}>Import</Button></>}>
        <Input label="File name" placeholder="orders.csv" />
        <Select label="Status for new orders"><option>Pending</option><option>Confirmed</option></Select>
      </Modal>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Order #1042" description="Abena Owusu · Accra"
        footer={<><Button onClick={() => setDrawer(false)}>Close</Button><Button variant="primary" onClick={() => setDrawer(false)}>Save</Button></>}>
        <Input label="Delivery address" defaultValue="12 Ring Road, Osu" />
        <Select label="Delivery agent"><option>Kofi Appiah</option><option>Esi Badu</option></Select>
      </Drawer>
    </div>
  );
}

export default function UiGallery() {
  return (
    <ToastProvider>
      <Body />
    </ToastProvider>
  );
}
