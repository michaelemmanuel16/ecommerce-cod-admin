import { useEffect, useMemo, useState } from 'react';
import { Archive, ImagePlus, Undo2 } from 'lucide-react';
import apiClient from '../../services/api';
import { Button, ConfirmDialog, Drawer, Input, Select, Skeleton, useToast } from '../../components/ui-v2';
import {
  productsService,
  type ArchiveResult,
  type ProductDetail,
  type ProductPayload,
  type StockLocationOption,
} from '../../services/products.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency } from '../../utils/format';
import { FILE_TYPES } from './model';

interface ProductDrawerProps {
  /** A product id (edit), 'new' (add) or null (closed). */
  target: number | 'new' | null;
  /** May this role write starting stock (products:update_stock)? */
  canStock: boolean;
  onClose: () => void;
  /** After any save, archive or restore: the page reloads its table. */
  onChanged: () => void;
}

interface Fields {
  productType: 'physical' | 'digital';
  name: string;
  description: string;
  sku: string;
  category: string;
  price: string;
  cogs: string;
  imageUrl: string;
  openingQuantity: string;
  openingLocation: string;
  lowStockDays: string;
  digitalFileUrl: string;
  digitalFileType: string;
  downloadLinkExpiryHours: string;
  maxDownloads: string;
  isActive: boolean;
}

const BLANK: Fields = {
  productType: 'physical', name: '', description: '', sku: '', category: '', price: '', cogs: '', imageUrl: '', openingQuantity: '', openingLocation: '',
  lowStockDays: '', digitalFileUrl: '', digitalFileType: 'PDF', downloadLinkExpiryHours: '72', maxDownloads: '5', isActive: true,
};
type Errors = Partial<Record<keyof Fields, string>>;

const fromDetail = (p: ProductDetail): Fields => ({
  productType: p.productType, name: p.name, description: p.description ?? '', sku: p.sku, category: p.category, price: String(p.price),
  cogs: p.cogs == null ? '' : String(p.cogs), imageUrl: p.imageUrl ?? '', openingQuantity: '', openingLocation: '',
  lowStockDays: p.lowStockDays == null ? '' : String(p.lowStockDays), digitalFileUrl: p.digitalFileUrl ?? '', digitalFileType: p.digitalFileType || 'PDF',
  downloadLinkExpiryHours: String(p.downloadLinkExpiryHours ?? 72), maxDownloads: String(p.maxDownloads ?? 5), isActive: p.isActive,
});

/** (price - cost) / price, whole percent: the same formula the table uses. */
const liveMargin = (price: number, cost: number) => (price > 0 ? Math.round(((price - cost) / price) * 100) : null);

/**
 * Add or edit a product (M4-T22, F-601, F-602). The type is locked once the product has orders; cost is read-only once a
 * shipment was received (landed cost sets it, F-611) and absent for a role that gets no cost from the API. Starting stock
 * is for a new product only. An existing product is archived or restored here, with what it still holds.
 */
export function ProductDrawer({ target, canStock, onClose, onChanged }: ProductDrawerProps) {
  const say = useToast();
  const open = target !== null;
  const isNew = target === 'new';
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [fields, setFields] = useState<Fields>(BLANK);
  const [errors, setErrors] = useState<Errors>({});
  const [locations, setLocations] = useState<StockLocationOption[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archived, setArchived] = useState<ArchiveResult | null>(null);

  useEffect(() => {
    if (target === null) return;
    setErrors({});
    setImageFile(null);
    setArchived(null);
    setSaving(false);
    setLoadFailed(false);
    if (target === 'new') {
      setDetail(null);
      setFields(BLANK);
      return;
    }
    let live = true;
    setDetail(null);
    productsService.detail(target).then(
      (p) => {
        if (!live) return;
        setDetail(p);
        setFields(fromDetail(p));
      },
      () => live && setLoadFailed(true),
    );
    return () => {
      live = false;
    };
  }, [target]);

  useEffect(() => {
    if (!isNew || !canStock) return;
    let live = true;
    productsService.stockLocations().then((list) => {
      if (!live) return;
      setLocations(list);
      const first = list.find((l) => l.type === 'partner_3pl') ?? list.find((l) => l.type === 'own_store') ?? list[0];
      setFields((f) => (f.openingLocation || !first ? f : { ...f, openingLocation: String(first.id) }));
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [isNew, canStock]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const digital = fields.productType === 'digital';
  /** The API sent a cost for this product, so this role may see and set it. */
  const costVisible = isNew || (detail !== null && detail.cogs !== undefined);
  const costLocked = !isNew && !!detail?.hasReceivedShipment;
  const typeLocked = !isNew && !!detail?.hasOrders;
  const price = Number(fields.price);
  const cost = Number(fields.cogs);
  const margin = costVisible && fields.price !== '' && fields.cogs !== '' && Number.isFinite(price) && Number.isFinite(cost) ? liveMargin(price, cost) : null;

  const check = (): Errors => {
    const e: Errors = {};
    if (!fields.name.trim()) e.name = 'Product name is required';
    if (!fields.sku.trim()) e.sku = 'SKU is required';
    if (!fields.category.trim()) e.category = 'Category is required';
    if (fields.price.trim() === '' || !Number.isFinite(price) || price < 0) e.price = 'Selling price must be 0 or more';
    if (costVisible && !costLocked && fields.cogs.trim() !== '' && (!Number.isFinite(cost) || cost < 0)) e.cogs = 'Cost must be 0 or more';
    if (digital && !fields.digitalFileUrl.trim()) e.digitalFileUrl = 'The file URL is required';
    if (digital) {
      const hours = Number(fields.downloadLinkExpiryHours);
      const max = Number(fields.maxDownloads);
      if (!Number.isInteger(hours) || hours < 1) e.downloadLinkExpiryHours = 'Hours must be a whole number above 0';
      if (!Number.isInteger(max) || max < 1) e.maxDownloads = 'Downloads must be a whole number above 0';
    }
    if (!digital && fields.lowStockDays.trim() !== '' && (!Number.isInteger(Number(fields.lowStockDays)) || Number(fields.lowStockDays) < 0)) e.lowStockDays = 'Days must be a whole number, 0 or more';
    if (isNew && !digital && canStock && fields.openingQuantity.trim() !== '') {
      const q = Number(fields.openingQuantity);
      if (!Number.isInteger(q) || q < 0) e.openingQuantity = 'Starting stock must be a whole number, 0 or more';
    }
    return e;
  };

  const save = async () => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      let imageUrl = fields.imageUrl;
      if (imageFile) {
        const upload = new FormData();
        upload.append('image', imageFile);
        const res = await apiClient.post('/api/upload', upload, { headers: { 'Content-Type': 'multipart/form-data' }, quiet: true });
        imageUrl = res.data.url || res.data.imageUrl || '';
      }
      const body: ProductPayload = {
        productType: fields.productType,
        name: fields.name.trim(),
        description: fields.description.trim(),
        sku: fields.sku.trim().toUpperCase(),
        category: fields.category.trim(),
        price,
        isActive: fields.isActive,
        ...(imageUrl ? { imageUrl } : {}),
        ...(costVisible && !costLocked ? { cogs: fields.cogs.trim() === '' ? 0 : cost } : {}),
        ...(digital
          ? {
              digitalFileUrl: fields.digitalFileUrl.trim(),
              digitalFileType: fields.digitalFileType,
              downloadLinkExpiryHours: Number(fields.downloadLinkExpiryHours),
              maxDownloads: Number(fields.maxDownloads),
            }
          : { lowStockDays: fields.lowStockDays.trim() === '' ? null : Number(fields.lowStockDays) }),
      };
      if (isNew) {
        if (!digital && canStock && Number(fields.openingQuantity) > 0) {
          body.openingStock = { locationId: Number(fields.openingLocation), quantity: Number(fields.openingQuantity) };
        }
        const created = await productsService.create(body);
        say(`${created.name} added`);
      } else {
        await productsService.update(target as number, body);
        say('Product saved');
      }
      onChanged();
      onClose();
    } catch (e) {
      setSaving(false);
      say(apiErrorMessage(e, 'The product could not be saved.'));
    }
  };

  const archive = async () => {
    setConfirmArchive(false);
    try {
      const result = await productsService.archive(target as number);
      setArchived(result);
      setFields((f) => ({ ...f, isActive: false }));
      say(`${result.product.name} archived`);
      onChanged();
    } catch (e) {
      say(apiErrorMessage(e, 'The product could not be archived.'));
    }
  };

  const restore = async () => {
    try {
      await productsService.restore(target as number);
      setArchived(null);
      setFields((f) => ({ ...f, isActive: true }));
      say('Product restored');
      onChanged();
    } catch (e) {
      say(apiErrorMessage(e, 'The product could not be restored.'));
    }
  };

  const loading = !isNew && target !== null && !detail && !loadFailed;
  const preview = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : fields.imageUrl), [imageFile, fields.imageUrl]);
  const isArchived = !isNew && !fields.isActive;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={isNew ? 'Add product' : 'Edit product'}
        description={isNew ? 'Physical products track stock. Digital products send a download link.' : fields.sku}
        footer={
          <>
            {!isNew && detail && (
              isArchived
                ? <Button onClick={() => void restore()}><Undo2 /> Restore</Button>
                : <Button variant="danger" onClick={() => setConfirmArchive(true)}><Archive /> Archive</Button>
            )}
            <span style={{ flex: 1 }} />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={saving || loading || loadFailed} onClick={() => void save()}>Save product</Button>
          </>
        }
      >
        {loadFailed ? (
          <p className="mut">The product could not load.</p>
        ) : loading ? (
          <div aria-busy="true" aria-label="Loading product">
            <Skeleton height={44} />
            <Skeleton height={44} className="skelgap" />
            <Skeleton height={44} className="skelgap" />
          </div>
        ) : (
          <form className="pform" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {archived && (
              <div className="landed bad" role="status">
                <span>
                  Archived. It still has {archived.openOrders} open {archived.openOrders === 1 ? 'order' : 'orders'}, {archived.unitsOnHand} {archived.unitsOnHand === 1 ? 'unit' : 'units'} on hand.
                  <small>It left new orders and forms. History and stock stay.</small>
                </span>
              </div>
            )}
            <div>
              <h4>Product type</h4>
              <div className="seg" role="group" aria-label="Product type">
                <button type="button" className={fields.productType === 'physical' ? 'on' : ''} aria-pressed={!digital} disabled={typeLocked} onClick={() => set('productType', 'physical')}>Physical</button>
                <button type="button" className={digital ? 'on' : ''} aria-pressed={digital} disabled={typeLocked} onClick={() => set('productType', 'digital')}>Digital</button>
              </div>
              {typeLocked && <p className="hint">The type cannot change once the product has orders.</p>}
            </div>

            <div>
              <h4>Basics</h4>
              <div className="fg">
                <Input className="full" label="Product name" placeholder="For example: Magic Groove copybook set" value={fields.name} error={errors.name} autoComplete="off" onChange={(e) => set('name', e.target.value)} />
                <div className="fl full">
                  <label htmlFor="pd-desc">Description <span className="opt">(optional)</span></label>
                  <textarea id="pd-desc" placeholder="What the customer gets" value={fields.description} onChange={(e) => set('description', e.target.value)} />
                </div>
                <Input label="SKU" placeholder="MG-CB-SET" value={fields.sku} error={errors.sku} autoComplete="off" onChange={(e) => set('sku', e.target.value)} />
                <Input label="Category" placeholder="Education" value={fields.category} error={errors.category} autoComplete="off" onChange={(e) => set('category', e.target.value)} />
                <div className="fl full">
                  <label htmlFor="pd-img">Image <span className="opt">(optional)</span></label>
                  {preview && <img src={preview} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 12, marginBottom: 8 }} />}
                  <input id="pd-img" type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
                  <p className="hint"><ImagePlus size={13} style={{ verticalAlign: -2 }} /> JPG or PNG, up to 5 MB.</p>
                </div>
              </div>
            </div>

            <div>
              <h4>Pricing</h4>
              <div className="fg">
                <Input label="Selling price" type="number" step="0.01" min={0} placeholder="249" value={fields.price} error={errors.price} onChange={(e) => set('price', e.target.value)} />
                {costVisible && (
                  <Input
                    label="Cost per unit"
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="30"
                    value={fields.cogs}
                    error={errors.cogs}
                    readOnly={costLocked}
                    hint={costLocked ? 'Set by the landed cost of the received shipments.' : undefined}
                    onChange={(e) => set('cogs', e.target.value)}
                  />
                )}
                {costVisible && (
                  <div className="fl full">
                    <div className={margin !== null && margin < 0 ? 'landed bad' : 'landed'}>
                      <span>
                        Margin before delivery
                        {margin !== null && margin < 0 && <small>Margin is negative</small>}
                      </span>
                      <b className="num" data-testid="live-margin">
                        {margin === null ? '—' : `${margin}%  ·  ${formatCurrency(price - cost)} per unit`}
                      </b>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!digital ? (
              <div>
                <h4>Stock</h4>
                <div className="fg">
                  {isNew && canStock && (
                    <>
                      <Input label="Starting stock" type="number" min={0} placeholder="0" hint="Counted at the holder you pick." value={fields.openingQuantity} error={errors.openingQuantity} onChange={(e) => set('openingQuantity', e.target.value)} />
                      <Select label="Holder" value={fields.openingLocation} onChange={(e) => set('openingLocation', e.target.value)}>
                        {locations.length === 0 && <option value="">Default holder</option>}
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </Select>
                    </>
                  )}
                  {!isNew && <p className="hint full">Change stock with Allocate stock or Adjust quantity in Inventory.</p>}
                  <Input label="Low stock alert at (days of cover)" type="number" min={0} placeholder="14" hint="Alert when stock covers fewer days than this. Empty uses the default." value={fields.lowStockDays} error={errors.lowStockDays} onChange={(e) => set('lowStockDays', e.target.value)} />
                </div>
              </div>
            ) : (
              <div>
                <h4>Digital file</h4>
                <div className="fg">
                  <Input className="full" label="File URL" placeholder="https://drive.google.com/file/d/..." value={fields.digitalFileUrl} error={errors.digitalFileUrl} autoComplete="off" onChange={(e) => set('digitalFileUrl', e.target.value)} />
                  <Select label="File type" value={fields.digitalFileType} onChange={(e) => set('digitalFileType', e.target.value)}>
                    {FILE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                  <Input label="Link expires after (hours)" type="number" min={1} value={fields.downloadLinkExpiryHours} error={errors.downloadLinkExpiryHours} onChange={(e) => set('downloadLinkExpiryHours', e.target.value)} />
                  <Input label="Max downloads" type="number" min={1} value={fields.maxDownloads} error={errors.maxDownloads} onChange={(e) => set('maxDownloads', e.target.value)} />
                  <p className="hint full">The customer gets the link by WhatsApp once the order is paid. No stock is tracked.</p>
                </div>
              </div>
            )}

            <label className="chk">
              <input type="checkbox" checked={fields.isActive} disabled={!isNew} onChange={(e) => set('isActive', e.target.checked)} />
              Product is active and can be ordered
            </label>
            <button type="submit" hidden />
          </form>
        )}
      </Drawer>
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
        action="Archive"
        count={1}
        noun="product"
        title={`Archive ${fields.name || 'this product'}?`}
      >
        It leaves new orders and forms. Its history and stock stay, and you can restore it.
      </ConfirmDialog>
    </>
  );
}

