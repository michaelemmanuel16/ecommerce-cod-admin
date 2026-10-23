import { Response } from 'express';
import { AuthRequest } from '../types';
import { Prisma } from '@prisma/client';
import prisma, { prismaBase } from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { withoutTenant } from '../utils/tenantContext';
import checkoutFormService, { clearCheckoutFormConfigCache } from '../services/checkoutFormService';
import { checkoutFormDesignSchema } from '../validators/checkoutFormDesignSchema';
import { getPaymentProvider, DEFAULT_PAYMENT_PROVIDER, methodMatrix } from '../services/payments';
import { loadProviderConfig, unsupportedCurrencyMessage } from '../services/payments/connectionConfig';
import { getTenantFeatures } from '../services/tenantFeatures';
import { encryptString, decryptString, SECRET_MASK } from '../utils/providerCrypto';
import * as Money from '../utils/money';
import { readDateBound } from '../utils/kpiRequest';
import { redirectUrlError, normalizeAllowedOrigins, pixelConfigError } from '../utils/checkoutFormRules';
import { missingRequiredLabels } from '../utils/checkoutLocation';
import { getRegionsForCountry } from '../utils/regions';
import { countryCodeOf, countryNameOfTenant } from '../services/locationService';
import { getStoreTimeZone, localDate, monthRange } from '../services/kpi/dates';
import { metaCapiService } from '../services/metaCapiService';

// The Meta CAPI access token is a write-only secret: admin reads get the mask
// sentinel (never the ciphertext), and a save that echoes the mask preserves
// the stored value. metaCapiTestEventCode is a non-secret dev code, sent plain.
const maskCapiToken = <T extends { metaCapiAccessToken?: string | null }>(form: T): T =>
  ({ ...form, metaCapiAccessToken: form.metaCapiAccessToken ? SECRET_MASK : null });

// Builds the Prisma patch for the two CAPI fields from a request body, encrypting
// a freshly-entered token and skipping the field when the masked sentinel comes
// back unchanged. Returns only the keys the client actually sent.
const metaCapiPatch = (body: any): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  if (body.metaCapiAccessToken !== undefined && body.metaCapiAccessToken !== SECRET_MASK) {
    const raw = body.metaCapiAccessToken ? String(body.metaCapiAccessToken).trim() : '';
    patch.metaCapiAccessToken = raw ? encryptString(raw) : null;
  }
  if (body.metaCapiTestEventCode !== undefined) {
    patch.metaCapiTestEventCode = body.metaCapiTestEventCode
      ? String(body.metaCapiTestEventCode).trim()
      : null;
  }
  return patch;
};

interface PaymentToggleState {
  codEnabled?: boolean | null;
  paystackDepositEnabled?: boolean | null;
  paystackFullEnabled?: boolean | null;
  depositPercent?: number | null;
  paymentProvider?: string | null;
  currency?: string | null;
  formType?: string | null;
}

// True when the request touches any payment-method field, so we only validate
// (and can fall back to schema defaults) when the client actually sends them.
const hasPaymentFields = (body: any): boolean =>
  body.codEnabled !== undefined ||
  body.paystackDepositEnabled !== undefined ||
  body.paystackFullEnabled !== undefined ||
  body.depositPercent !== undefined;

/**
 * Validates the payment settings on form save. Resolves each toggle from the request body, falling back to the
 * existing row (on update) or the schema default (on create). Rules: the method matrix (form type x tenant flag),
 * at least one method on, at most two on (the public form renders max two buttons), a 1–99 deposit percent when
 * deposit is on, a connected payment account before any online method can be enabled, and (F-401) a currency that
 * account can take. A request that touches only the currency gets the currency check alone.
 * Returns an error response to send, or null.
 */
const validatePaymentConfig = async (
  body: any,
  existing: PaymentToggleState | null,
  tenantId: string | null,
): Promise<{ status: number; body: Record<string, unknown> } | null> => {
  const paymentTouched = hasPaymentFields(body);
  if (!paymentTouched && body.currency === undefined) return null;

  const pick = (bodyVal: unknown, existingVal: boolean | null | undefined, def: boolean): boolean =>
    bodyVal !== undefined ? Boolean(bodyVal) : existing ? Boolean(existingVal) : def;

  const cod = pick(body.codEnabled, existing?.codEnabled, true);
  const deposit = pick(body.paystackDepositEnabled, existing?.paystackDepositEnabled, false);
  const full = pick(body.paystackFullEnabled, existing?.paystackFullEnabled, false);

  // Carry both `error` (API contract) and `message` (what the frontend axios
  // interceptor surfaces in the toast) so the admin sees the specific reason.
  const fail = (text: string, extra: Record<string, unknown> = {}) => ({
    status: 400,
    body: { error: text, message: text, ...extra },
  });

  if (paymentTouched) {
    const enabledCount = [cod, deposit, full].filter(Boolean).length;

    // Method matrix (F-402): form type x tenant flag. A method the matrix forbids cannot be switched on. A toggle
    // that is already stored on stays as it is, so turning the flag off never makes a saved form unsavable;
    // the public checkout still refuses the method.
    const formType = (body.formType ?? existing?.formType) === 'digital' ? 'digital' : 'physical';
    const matrix = methodMatrix(formType, (await getTenantFeatures(tenantId)).prepaidPhysical);
    const switchedOn = (now: boolean, was: boolean | null | undefined) => now && !was;
    if (
      (switchedOn(cod, existing?.codEnabled) && !matrix.cod) ||
      (switchedOn(deposit, existing?.paystackDepositEnabled) && !matrix.online_deposit) ||
      (switchedOn(full, existing?.paystackFullEnabled) && !matrix.online_full)
    ) {
      return fail(
        formType === 'digital'
          ? 'Digital products are paid online in full.'
          : 'Online payment is paused for physical products.',
      );
    }

    if (enabledCount < 1) return fail('At least one payment method must be enabled');
    if (enabledCount > 2) return fail('At most two payment methods can be enabled at once');

    if (deposit) {
      const pct =
        body.depositPercent !== undefined ? Number(body.depositPercent) : Number(existing?.depositPercent);
      if (!Number.isInteger(pct) || pct < 1 || pct > 99) {
        return fail('Deposit percent must be a whole number between 1 and 99');
      }
    }
  }

  if ((deposit || full) && (paymentTouched || tenantId)) {
    const provider = getPaymentProvider(existing?.paymentProvider ?? DEFAULT_PAYMENT_PROVIDER);
    const config = tenantId ? await loadProviderConfig(tenantId, provider.id) : null;
    if (paymentTouched && !(config && config.isEnabled && config.secretKey)) {
      return fail(`${provider.displayName} disabled until you add keys`, { link: '/settings/integrations' });
    }
    // F-401: the account must be able to take the form's currency.
    const text = unsupportedCurrencyMessage(config, String(body.currency ?? existing?.currency ?? 'GHS'));
    if (text) return fail(text);
  }

  return null;
};

// Maps the three toggle fields + deposit percent from a request body into a
// Prisma data patch, including only the fields the client actually sent.
const paymentTogglePatch = (body: any): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  if (body.codEnabled !== undefined) patch.codEnabled = Boolean(body.codEnabled);
  if (body.paystackDepositEnabled !== undefined) patch.paystackDepositEnabled = Boolean(body.paystackDepositEnabled);
  if (body.paystackFullEnabled !== undefined) patch.paystackFullEnabled = Boolean(body.paystackFullEnabled);
  if (body.depositPercent !== undefined) {
    patch.depositPercent =
      body.depositPercent === null ? null : parseInt(String(body.depositPercent), 10);
  }
  return patch;
};

const resolveTenantId = (req: AuthRequest): string | null =>
  (req as any).tenantId || (req as any).user?.tenantId || null;

const fail400 = (res: Response, text: string, extra: Record<string, unknown> = {}): void => {
  res.status(400).json({ error: text, message: text, ...extra });
};

// Admin reads and writes see inactive forms too (a new clone starts inactive); the isActive filter is for the public routes.
const findForm = (formId: number) => withSoftDeleted(() => prisma.checkoutForm.findUnique({ where: { id: formId } }));

/**
 * Basics rules (F-411): https thank-you page, allowed domains as `https://host`, tracking ids. Only what the body sends is checked.
 * Returns the error text, or the normalized allowed origins (undefined when the body does not send them).
 */
const checkBasics = (body: any): { error: string } | { origins: string[] | undefined } => {
  const redirectError = redirectUrlError(body.redirectUrl);
  if (redirectError) return { error: redirectError };
  const trackingError = pixelConfigError(body.pixelConfig);
  if (trackingError) return { error: trackingError };
  if (body.allowedOrigins === undefined) return { origins: undefined };
  const origins = normalizeAllowedOrigins(body.allowedOrigins);
  if ('bad' in origins) return { error: `"${origins.bad}" is not a valid domain. Use a host such as shop.example.com.` };
  return { origins: origins.origins };
};

/**
 * Regions a form offers must be regions of its country (F-413). Names are stored in the library's spelling, at least one
 * stays. A new form that names none starts with every region of the country. Returns the error text or the value to store.
 */
const checkRegions = (country: string, regions: any, isNew: boolean): { error: string } | { value: any } => {
  const code = countryCodeOf(country);
  const list = code ? getRegionsForCountry(code) : [];
  const given = regions?.available;
  if (!Array.isArray(given)) return { value: isNew && list.length > 0 ? { ...(regions ?? {}), available: list } : regions };
  if (list.length === 0) return { value: regions };
  const chosen: string[] = [];
  for (const name of given) {
    const match = list.find((r) => r.toLowerCase() === String(name).trim().toLowerCase());
    if (!match) return { error: `"${name}" is not a region of ${country}.` };
    if (!chosen.includes(match)) chosen.push(match);
  }
  if (chosen.length === 0) return { error: 'Keep at least one region.' };
  return { value: { ...regions, available: chosen } };
};

// "This form can't take orders yet. Add: Street address." (F-411); null when the form is fine.
const missingKeysError = (fields: unknown, formType: string): string | null => {
  const missing = missingRequiredLabels(fields, formType);
  return missing.length ? `This form can't take orders yet. Add: ${missing.join(', ')}.` : null;
};

// An upsell on a digital form that names a product must name a digital one (F-422).
const digitalUpsellError = async (upsells: any[] | undefined): Promise<string | null> => {
  const ids = (upsells ?? []).map((u) => u?.productId).filter((id) => id !== undefined && id !== null).map(Number);
  if (ids.length === 0) return null;
  const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, productType: true } });
  const digital = new Set(products.filter((p) => p.productType === 'digital').map((p) => p.id));
  return ids.every((id) => digital.has(id)) ? null : 'Add-ons on a digital form must be digital products.';
};

const TYPE_MISMATCH = 'Form type must match the product (digital/physical).';

// Orders per form from the form's submissions: this store month and all time. One grouped query for all forms of a page.
const ordersByForm = async (formIds: number[], tenantId: string | null): Promise<Map<number, { month: number; total: number }>> => {
  if (formIds.length === 0) return new Map();
  const zone = getStoreTimeZone(tenantId);
  const [year, month] = localDate(new Date(), zone).split('-').map(Number);
  const monthStart = monthRange(year, month, zone).from;
  const rows = await prisma.$queryRaw<Array<{ formId: number; total: number; month: number }>>(Prisma.sql`
    SELECT fs.form_id AS "formId",
           COUNT(DISTINCT o.id)::int AS total,
           (COUNT(DISTINCT o.id) FILTER (WHERE o.created_at >= ${monthStart}))::int AS month
    FROM form_submissions fs
    JOIN orders o ON o.id = fs.order_id
    WHERE fs.form_id IN (${Prisma.join(formIds)})
      AND o.source = 'checkout_form' AND o.deleted_at IS NULL
      ${tenantId ? Prisma.sql`AND o.tenant_id = ${tenantId}` : Prisma.empty}
    GROUP BY fs.form_id`);
  return new Map(rows.map((r) => [r.formId, { month: r.month, total: r.total }]));
};

// True when no other active form sells this form's product (the form itself is about to go off).
const lastActiveFormOfProduct = async (form: { id: number; productId: number; isActive: boolean }): Promise<boolean> =>
  form.isActive && (await prisma.checkoutForm.count({ where: { productId: form.productId, id: { not: form.id }, isActive: true, archivedAt: null } })) === 0;

const NO_ACTIVE_FORM = 'No active form sells this product.';

const validateDesign = (
  raw: unknown,
): { ok: true; value: Prisma.InputJsonValue | undefined } | { ok: false; issues: unknown } => {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: Prisma.JsonNull as unknown as Prisma.InputJsonValue };
  const parsed = checkoutFormDesignSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  return { ok: true, value: parsed.data as Prisma.InputJsonValue };
};

export const getAllCheckoutForms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, isActive, archived, page = 1, limit = 20 } = req.query;

    // Archived forms are hidden unless asked for; inactive ones always show (the list has an active switch).
    const where: Prisma.CheckoutFormWhereInput = { archivedAt: archived === 'true' ? { not: null } : null };

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { slug: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [forms, total] = await withSoftDeleted(() => Promise.all([
      prisma.checkoutForm.findMany({
        where,
        include: {
          product: true,
          packages: {
            orderBy: { sortOrder: 'asc' }
          },
          upsells: {
            orderBy: { sortOrder: 'asc' }
          },
          _count: {
            select: { submissions: true }
          }
        },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.checkoutForm.count({ where })
    ]));

    const orders = await ordersByForm(forms.map((f) => f.id), resolveTenantId(req));

    res.json({
      forms: forms.map((f) => ({
        ...maskCapiToken(f),
        ordersThisMonth: orders.get(f.id)?.month ?? 0,
        ordersTotal: orders.get(f.id)?.total ?? 0,
        conversion: null, // visits are counted from M8 (F-409)
      })),
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    throw error;
  }
};

export const getCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const formId = parseInt(id, 10);

    if (isNaN(formId)) {
      res.status(400).json({ message: 'Invalid form ID' });
      return;
    }

    const form = await withSoftDeleted(() => prisma.checkoutForm.findUnique({ where: { id: formId },
      include: {
        product: true,
        packages: {
          orderBy: { sortOrder: 'asc' }
        },
        upsells: {
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { submissions: true }
        }
      }
    }));

    if (!form) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    res.json({ form: maskCapiToken(form) });
  } catch (error) {
    throw error;
  }
};

/**
 * Admin preview-config: returns the render-shape payload for the editor's
 * live preview iframe. Mirrors the public response but allows draft/inactive
 * forms. Auth + tenant scope are enforced by the route middleware.
 */
export const previewCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const formId = parseInt(id, 10);
    if (isNaN(formId)) {
      res.status(400).json({ message: 'Invalid form ID' });
      return;
    }
    const tenantId = (req as any).tenantId || (req as any).user?.tenantId || null;
    const form = await checkoutFormService.getCheckoutFormForPreview(formId, tenantId);
    res.json({ form });
  } catch (error: any) {
    if (error?.statusCode === 404) {
      res.status(404).json({ message: 'Checkout form not found' });
      return;
    }
    throw error;
  }
};

export const createCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name,
      slug,
      productId,
      description,
      fields,
      styling,
      design,
      currency,
      regions,
      packages,
      upsells,
      isActive,
      pixelConfig,
      redirectUrl
    } = req.body;

    const designValidation = validateDesign(design);
    if (!designValidation.ok) {
      res.status(400).json({ error: 'Invalid design payload', issues: designValidation.issues });
      return;
    }

    const basics = checkBasics(req.body);
    if ('error' in basics) {
      fail400(res, basics.error);
      return;
    }

    // The form type follows the product's type (F-422); the payment rules below depend on it.
    const productForType = await prisma.product.findUnique({ where: { id: productId } });
    const formType = productForType?.productType === 'digital' ? 'digital' : 'physical';
    if (req.body.formType !== undefined && productForType && req.body.formType !== formType) {
      fail400(res, TYPE_MISMATCH);
      return;
    }

    const paymentError = await validatePaymentConfig({ ...req.body, formType }, null, resolveTenantId(req));
    if (paymentError) {
      res.status(paymentError.status).json(paymentError.body);
      return;
    }

    // Country is read-only: it comes from the store (F-411). A new form starts with all regions of that country.
    const storeCountry = await countryNameOfTenant(resolveTenantId(req));
    const regionCheck = checkRegions(storeCountry, regions, true);
    if ('error' in regionCheck) {
      fail400(res, regionCheck.error);
      return;
    }

    const willBeActive = isActive !== undefined ? Boolean(isActive) : true;
    const keysError = willBeActive ? missingKeysError(fields, formType) : null;
    if (keysError) {
      fail400(res, keysError);
      return;
    }

    const upsellError = formType === 'digital' ? await digitalUpsellError(upsells) : null;
    if (upsellError) {
      fail400(res, upsellError);
      return;
    }

    // Check if slug already exists
    const existing = await prisma.checkoutForm.findUnique({
      where: { slug }
    });

    if (existing) {
      res.status(400).json({ error: 'Slug already exists' });
      return;
    }

    // Check if product exists
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // Validate and normalize data before Prisma
    const normalizedPackages = packages?.map((pkg: any, index: number) => ({
      name: pkg.name || '',
      description: pkg.description || null,
      price: Money.tryParse(pkg.price) ?? Money.ZERO,
      quantity: parseInt(pkg.quantity) || 1,
      discountType: pkg.discountType || 'none',
      discountValue: Money.tryParse(pkg.discountValue) ?? Money.ZERO,
      originalPrice: Money.tryParse(pkg.originalPrice),
      isPopular: Boolean(pkg.isPopular),
      isDefault: Boolean(pkg.isDefault),
      showHighlight: Boolean(pkg.showHighlight),
      highlightText: pkg.highlightText || null,
      showDiscount: pkg.showDiscount !== false,
      sortOrder: pkg.sortOrder !== undefined ? parseInt(pkg.sortOrder) : index
    }));

    const normalizedUpsells = upsells?.map((upsell: any, index: number) => ({
      name: upsell.name || '',
      description: upsell.description || null,
      imageUrl: upsell.imageUrl || null,
      price: Money.tryParse(upsell.price) ?? Money.ZERO,
      items: upsell.items || null,
      productId: upsell.productId ? Number(upsell.productId) : null,
      sortOrder: upsell.sortOrder !== undefined ? parseInt(upsell.sortOrder) : index
    }));

    // Wrap Prisma.create in timeout to prevent hanging
    const createWithTimeout = async () => {
      return Promise.race([
        prisma.checkoutForm.create({
          data: {
            name,
            slug,
            productId,
            description,
            fields,
            styling,
            design: designValidation.value,
            country: storeCountry,
            currency: currency || 'GHS',
            regions: regionCheck.value,
            formType,
            isActive: willBeActive,
            pixelConfig: pixelConfig && typeof pixelConfig === 'object' ? pixelConfig : undefined,
            redirectUrl: redirectUrl ? String(redirectUrl).trim() : null,
            allowedOrigins: basics.origins ?? [],
            ...paymentTogglePatch(req.body),
            ...metaCapiPatch(req.body),
            packages: normalizedPackages && normalizedPackages.length > 0 ? {
              create: normalizedPackages
            } : undefined,
            upsells: normalizedUpsells && normalizedUpsells.length > 0 ? {
              create: normalizedUpsells
            } : undefined
          },
          include: {
            product: true,
            packages: true,
            upsells: true
          }
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Prisma operation timed out after 15 seconds')), 15000)
        )
      ]);
    };

    const form = await createWithTimeout() as any;

    res.status(201).json({ form });
  } catch (error: any) {
    // Handle timeout errors
    if (error?.message?.includes('timed out')) {
      res.status(500).json({
        error: 'Database operation timed out. Please check your data and try again.'
      });
      return;
    }

    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(400).json({ error: 'A checkout form with this slug already exists' });
        return;
      }
      if (error.code === 'P2003') {
        res.status(400).json({ error: 'Referenced product does not exist' });
        return;
      }
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Record not found' });
        return;
      }
    }

    // Handle validation errors
    if (error instanceof Prisma.PrismaClientValidationError) {
      res.status(400).json({ error: 'Invalid data provided for checkout form' });
      return;
    }

    // Generic error response
    res.status(500).json({ error: 'Failed to create checkout form. Please try again.' });
  }
};

export const updateCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const formId = parseInt(id, 10);

    if (isNaN(formId)) {
      res.status(400).json({ message: 'Invalid form ID' });
      return;
    }

    const {
      name,
      slug,
      productId,
      description,
      fields,
      styling,
      design,
      currency,
      regions,
      packages,
      upsells,
      isActive,
      pixelConfig,
      redirectUrl
    } = req.body;

    const designValidation = validateDesign(design);
    if (!designValidation.ok) {
      res.status(400).json({ error: 'Invalid design payload', issues: designValidation.issues });
      return;
    }

    // Check if form exists
    const existing = await withSoftDeleted(() => prisma.checkoutForm.findUnique({ where: { id: formId }, include: { product: { select: { productType: true } } } }));

    if (!existing) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    const basics = checkBasics(req.body);
    if ('error' in basics) {
      fail400(res, basics.error);
      return;
    }

    // If product is being changed, check if it exists
    let newProduct: { productType: string } | null = null;
    if (productId && productId !== existing.productId) {
      newProduct = await prisma.product.findUnique({ where: { id: productId } });

      if (!newProduct) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
    }

    // The form type follows the product (F-422). A product of the other type is not allowed once the form has orders.
    const productType = (newProduct ?? (existing as any).product)?.productType as string | undefined;
    if (req.body.formType !== undefined && productType && req.body.formType !== productType) {
      fail400(res, TYPE_MISMATCH);
      return;
    }
    let formType = existing.formType;
    if (newProduct && newProduct.productType !== existing.formType) {
      if ((await prisma.formSubmission.count({ where: { formId } })) > 0) {
        fail400(res, 'This form has orders. Its product type cannot change.');
        return;
      }
      formType = newProduct.productType;
    }

    const paymentError = await validatePaymentConfig({ ...req.body, formType }, existing, resolveTenantId(req));
    if (paymentError) {
      res.status(paymentError.status).json(paymentError.body);
      return;
    }

    // Country is read-only, so a `country` in the body is ignored. Regions must belong to it.
    let regionsValue = regions;
    if (regions !== undefined) {
      const regionCheck = checkRegions(existing.country, regions, false);
      if ('error' in regionCheck) {
        fail400(res, regionCheck.error);
        return;
      }
      regionsValue = regionCheck.value;
    }

    // An archived form comes back through restore, not through the active switch.
    if (isActive === true && existing.archivedAt) {
      fail400(res, 'This form is archived. Restore it first.');
      return;
    }
    const willBeActive = isActive !== undefined ? Boolean(isActive) : existing.isActive;
    const keysError = willBeActive && (isActive === true || fields !== undefined)
      ? missingKeysError(fields ?? existing.fields, formType)
      : null;
    if (keysError) {
      fail400(res, keysError);
      return;
    }

    const upsellError = formType === 'digital' && upsells ? await digitalUpsellError(upsells) : null;
    if (upsellError) {
      fail400(res, upsellError);
      return;
    }

    // If slug is being changed, check for conflicts
    if (slug && slug !== existing.slug) {
      const slugConflict = await prisma.checkoutForm.findUnique({
        where: { slug }
      });

      if (slugConflict) {
        res.status(400).json({ error: 'Slug already exists' });
        return;
      }
    }

    // Update form
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (productId !== undefined) updateData.productId = productId;
    if (formType !== existing.formType) updateData.formType = formType;
    if (description !== undefined) updateData.description = description;
    if (fields !== undefined) updateData.fields = fields;
    if (styling !== undefined) updateData.styling = styling;
    if (design !== undefined) updateData.design = designValidation.value;
    if (currency !== undefined) updateData.currency = currency;
    if (regions !== undefined) updateData.regions = regionsValue;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (pixelConfig !== undefined) updateData.pixelConfig = pixelConfig && typeof pixelConfig === 'object' ? pixelConfig : null;
    if (redirectUrl !== undefined) updateData.redirectUrl = redirectUrl ? String(redirectUrl).trim() : null;
    if (basics.origins !== undefined) updateData.allowedOrigins = basics.origins;
    Object.assign(updateData, paymentTogglePatch(req.body));
    Object.assign(updateData, metaCapiPatch(req.body));

    await prisma.checkoutForm.update({
      where: { id: formId },
      data: updateData
    });

    // Update packages if provided. `existing` above was read through the tenant-scoped
    // client, so formId is a form of this tenant.
    if (packages) {
      await prisma.formPackage.deleteMany({
        where: { formId: formId }
      });

      await prisma.formPackage.createMany({
        data: packages.map((pkg: any, index: number) => ({
          formId: formId,
          name: pkg.name,
          description: pkg.description,
          price: pkg.price,
          quantity: pkg.quantity,
          discountType: pkg.discountType || 'none',
          discountValue: pkg.discountValue || 0,
          originalPrice: pkg.originalPrice || null,
          isPopular: pkg.isPopular || false,
          isDefault: pkg.isDefault || false,
          showHighlight: pkg.showHighlight || false,
          highlightText: pkg.highlightText || null,
          showDiscount: pkg.showDiscount !== false,
          sortOrder: pkg.sortOrder !== undefined ? pkg.sortOrder : index
        }))
      });
    }

    // Update upsells if provided
    if (upsells) {
      await prisma.formUpsell.deleteMany({
        where: { formId: formId }
      });

      await prisma.formUpsell.createMany({
        data: upsells.map((upsell: any, index: number) => ({
          formId: formId,
          name: upsell.name,
          description: upsell.description,
          imageUrl: upsell.imageUrl,
          price: upsell.price,
          items: upsell.items,
          productId: upsell.productId ? Number(upsell.productId) : null,
          sortOrder: upsell.sortOrder !== undefined ? upsell.sortOrder : index
        }))
      });
    }

    // Invalidate the embed config cache only after all writes (form + packages +
    // upsells) have committed, so a concurrent /config read can't re-cache a
    // half-updated form. Clear both the old and (if renamed) the new slug.
    clearCheckoutFormConfigCache(existing.slug);
    if (slug && slug !== existing.slug) clearCheckoutFormConfigCache(slug);

    // Fetch updated form with all relations
    const updatedForm = await withSoftDeleted(() => prisma.checkoutForm.findUnique({ where: { id: formId },
      include: {
        product: true,
        packages: {
          orderBy: { sortOrder: 'asc' }
        },
        upsells: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    }));

    res.json({ form: updatedForm ? maskCapiToken(updatedForm) : updatedForm });
  } catch (error) {
    console.error('Error updating checkout form:', error);

    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(400).json({ error: 'A checkout form with this slug already exists' });
        return;
      }
      if (error.code === 'P2003') {
        res.status(400).json({ error: 'Referenced product does not exist' });
        return;
      }
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Checkout form not found' });
        return;
      }
    }

    // Handle validation errors
    if (error instanceof Prisma.PrismaClientValidationError) {
      res.status(400).json({ error: 'Invalid data provided for checkout form' });
      return;
    }

    // Generic error response
    res.status(500).json({ error: 'Failed to update checkout form. Please try again.' });
  }
};

/**
 * Remove a form (F-408). A form that has taken submissions, or has a payment in flight, is archived instead: hidden from
 * the list, off for the public, slug kept. Any other form is deleted for good.
 */
export const deleteCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const formId = parseInt(id, 10);

    if (isNaN(formId)) {
      res.status(400).json({ message: 'Invalid form ID' });
      return;
    }

    const form = await withSoftDeleted(() => prisma.checkoutForm.findUnique({ where: { id: formId }, include: { _count: { select: { submissions: true } } } }));

    if (!form) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    const warning = (await lastActiveFormOfProduct(form)) ? { warning: NO_ACTIVE_FORM } : {};
    const hasHistory = form._count.submissions > 0 || (await prisma.pendingCheckout.count({ where: { formId } })) > 0;

    if (hasHistory) {
      await prisma.checkoutForm.update({ where: { id: formId }, data: { archivedAt: new Date(), isActive: false } });
      clearCheckoutFormConfigCache(form.slug);
      const ordersTotal = (await ordersByForm([formId], resolveTenantId(req))).get(formId)?.total ?? 0;
      res.json({ archived: true, ordersTotal, message: 'Checkout form archived', ...warning });
      return;
    }

    // The scoped client turns delete into "set inactive"; this form belongs to the tenant (found above), so the base client removes it.
    await prismaBase.checkoutForm.delete({ where: { id: formId } });

    // Drop any cached embed config so the widget stops serving a deleted form.
    clearCheckoutFormConfigCache(form.slug);

    res.json({ deleted: true, message: 'Checkout form deleted successfully', ...warning });
  } catch (error) {
    console.error('Error deleting checkout form:', error);

    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Checkout form not found' });
        return;
      }
      if (error.code === 'P2003') {
        res.status(400).json({ error: 'Cannot delete checkout form with existing submissions' });
        return;
      }
    }

    // Generic error response
    res.status(500).json({ error: 'Failed to delete checkout form. Please try again.' });
  }
};

/** Bring an archived form back. It stays inactive; the owner switches it on. */
export const restoreCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  const formId = parseInt(req.params.id, 10);
  if (isNaN(formId)) {
    res.status(400).json({ message: 'Invalid form ID' });
    return;
  }
  const form = await findForm(formId);
  if (!form || !form.archivedAt) {
    res.status(404).json({ error: 'Checkout form not found' });
    return;
  }
  const restored = await prisma.checkoutForm.update({ where: { id: formId }, data: { archivedAt: null } });
  clearCheckoutFormConfigCache(form.slug);
  res.json({ form: maskCapiToken(restored) });
};

const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form';

/**
 * Copy a form (F-408): fields, packages, upsells, design, regions, payment settings and tracking ids. It starts inactive,
 * named "<name> (copy)", with a free slug. The Conversion API token and test event code are secrets and are not copied.
 */
export const cloneCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const formId = parseInt(req.params.id, 10);
    if (isNaN(formId)) {
      res.status(400).json({ message: 'Invalid form ID' });
      return;
    }
    const source = await withSoftDeleted(() => prisma.checkoutForm.findUnique({ where: { id: formId }, include: { packages: true, upsells: true } }));
    if (!source) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    const name = `${source.name} (copy)`;
    const base = slugify(name);
    // Slugs are unique across all tenants and archived forms keep theirs, so look at every form.
    const taken = new Set(
      (await withoutTenant('clone slug check', () => withSoftDeleted(() =>
        prisma.checkoutForm.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } }),
      ))).map((f) => f.slug),
    );
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

    const json = (v: Prisma.JsonValue | null) => (v === null ? undefined : (v as Prisma.InputJsonValue));
    const form = await prisma.checkoutForm.create({
      data: {
        name,
        slug,
        productId: source.productId,
        description: source.description,
        fields: json(source.fields) as Prisma.InputJsonValue,
        styling: json(source.styling) as Prisma.InputJsonValue,
        design: json(source.design),
        country: source.country,
        currency: source.currency,
        regions: json(source.regions) as Prisma.InputJsonValue,
        formType: source.formType,
        pixelConfig: json(source.pixelConfig),
        redirectUrl: source.redirectUrl,
        allowedOrigins: source.allowedOrigins,
        codEnabled: source.codEnabled,
        paystackDepositEnabled: source.paystackDepositEnabled,
        paystackFullEnabled: source.paystackFullEnabled,
        depositPercent: source.depositPercent,
        paymentProvider: source.paymentProvider,
        isActive: false,
        archivedAt: null,
        packages: {
          create: source.packages.map(({ id: _id, formId: _formId, createdAt: _createdAt, ...pkg }) => pkg),
        },
        upsells: {
          create: source.upsells.map(({ id: _id, formId: _formId, createdAt: _createdAt, items, ...upsell }) => ({ ...upsell, items: json(items) })),
        },
      },
      include: { product: true, packages: true, upsells: true },
    });

    res.status(201).json({ form: maskCapiToken(form), capiTokenNotCopied: Boolean(source.metaCapiAccessToken) });
  } catch (error) {
    console.error('Error cloning checkout form:', error);
    res.status(500).json({ error: 'Failed to copy the checkout form. Please try again.' });
  }
};

/** Send one test Purchase to Meta with the form's stored token and test event code (F-416). */
export const sendTestEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  const formId = parseInt(req.params.id, 10);
  if (isNaN(formId)) {
    res.status(400).json({ message: 'Invalid form ID' });
    return;
  }
  const form = await findForm(formId);
  if (!form) {
    res.status(404).json({ error: 'Checkout form not found' });
    return;
  }
  const accessToken = decryptString(form.metaCapiAccessToken);
  if (!accessToken || !form.metaCapiTestEventCode) {
    fail400(res, 'Add a Conversion API token and a test event code first.');
    return;
  }
  const pixelId = (form.pixelConfig as { facebookPixelId?: string } | null)?.facebookPixelId;
  if (!pixelId) {
    fail400(res, 'Add a Facebook Pixel ID first.');
    return;
  }
  res.json(await metaCapiService.sendTestEvent({
    pixelId,
    accessToken,
    testEventCode: form.metaCapiTestEventCode,
    currency: form.currency,
    productId: form.productId,
  }));
};

export const getFormStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const formId = parseInt(id, 10);

    if (isNaN(formId)) {
      res.status(400).json({ message: 'Invalid form ID' });
      return;
    }

    const { startDate, endDate } = req.query;

    const form = await findForm(formId);

    if (!form) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    const where: any = { formId: formId };

    if (startDate || endDate) {
      where.createdAt = {};
      // An invalid value is a 400 (readDateBound throws INVALID_RANGE).
      if (startDate) where.createdAt.gte = readDateBound(startDate, 'from');
      if (endDate) where.createdAt.lte = readDateBound(endDate, 'to');
    }

    const [submissions, totalRevenue] = await Promise.all([
      prisma.formSubmission.count({ where }),
      prisma.formSubmission.aggregate({
        where,
        _sum: {
          totalAmount: true
        }
      })
    ]);

    const submissionsWithOrders = await prisma.formSubmission.count({
      where: {
        ...where,
        orderId: { not: null }
      }
    });

    const conversionRate = submissions > 0 ? (submissionsWithOrders / submissions) * 100 : 0;
    const revenue = totalRevenue._sum.totalAmount ?? Money.ZERO;

    res.json({
      stats: {
        totalSubmissions: submissions,
        conversions: submissionsWithOrders,
        conversionRate: Math.round(conversionRate * 100) / 100,
        totalRevenue: revenue,
        averageOrderValue: submissions > 0 ? Money.div(revenue, submissions) : Money.ZERO
      }
    });
  } catch (error) {
    throw error;
  }
};
