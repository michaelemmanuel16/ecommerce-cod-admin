import { Response } from 'express';
import { AuthRequest } from '../types';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import checkoutFormService, { clearCheckoutFormConfigCache } from '../services/checkoutFormService';
import { checkoutFormDesignSchema } from '../validators/checkoutFormDesignSchema';
import { paystackService } from '../services/paystackService';

interface PaymentToggleState {
  codEnabled?: boolean | null;
  paystackDepositEnabled?: boolean | null;
  paystackFullEnabled?: boolean | null;
  depositPercent?: number | null;
}

// True when the request touches any payment-method field, so we only validate
// (and can fall back to schema defaults) when the client actually sends them.
const hasPaymentFields = (body: any): boolean =>
  body.codEnabled !== undefined ||
  body.paystackDepositEnabled !== undefined ||
  body.paystackFullEnabled !== undefined ||
  body.depositPercent !== undefined;

/**
 * Validates the COD / deposit / full-pay toggle matrix on form save. Resolves
 * each toggle from the request body, falling back to the existing row (on
 * update) or the schema default (on create). Rules: at least one method on, at
 * most two on (the public form renders max two buttons), a 1–99 deposit percent
 * when deposit is on, and a tenant Paystack account configured before any
 * Paystack method can be enabled. Returns an error response to send, or null.
 */
const validatePaymentConfig = async (
  body: any,
  existing: PaymentToggleState | null,
  tenantId: string | null,
): Promise<{ status: number; body: Record<string, unknown> } | null> => {
  if (!hasPaymentFields(body)) return null;

  const pick = (bodyVal: unknown, existingVal: boolean | null | undefined, def: boolean): boolean =>
    bodyVal !== undefined ? Boolean(bodyVal) : existing ? Boolean(existingVal) : def;

  const cod = pick(body.codEnabled, existing?.codEnabled, true);
  const deposit = pick(body.paystackDepositEnabled, existing?.paystackDepositEnabled, false);
  const full = pick(body.paystackFullEnabled, existing?.paystackFullEnabled, false);
  const enabledCount = [cod, deposit, full].filter(Boolean).length;

  // Carry both `error` (API contract) and `message` (what the frontend axios
  // interceptor surfaces in the toast) so the admin sees the specific reason.
  const fail = (text: string, extra: Record<string, unknown> = {}) => ({
    status: 400,
    body: { error: text, message: text, ...extra },
  });

  if (enabledCount < 1) return fail('At least one payment method must be enabled');
  if (enabledCount > 2) return fail('At most two payment methods can be enabled at once');

  if (deposit) {
    const pct =
      body.depositPercent !== undefined ? Number(body.depositPercent) : Number(existing?.depositPercent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 99) {
      return fail('Deposit percent must be a whole number between 1 and 99');
    }
  }

  if (deposit || full) {
    const configured = tenantId ? await paystackService.isConfigured(tenantId) : false;
    if (!configured) {
      return fail('Paystack disabled until you add keys', { link: '/settings/integrations' });
    }
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

// Normalize an allowed-origins payload into canonical Origin form
// (scheme://host[:port], no path/trailing slash, lowercased host) so stored
// entries compare cleanly against the browser's `Origin` header at the gate.
// Entries that aren't parseable URLs are dropped.
const normalizeAllowedOrigins = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const origins = raw.flatMap((o) => {
    const value = String(o).trim();
    if (!value) return [];
    try {
      return [new URL(value).origin];
    } catch {
      return [];
    }
  });
  return Array.from(new Set(origins));
};

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
    const { search, isActive, page = 1, limit = 20 } = req.query;

    const where: any = {};

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { slug: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [forms, total] = await Promise.all([
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
    ]);

    res.json({
      forms,
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

    const form = await prisma.checkoutForm.findUnique({
      where: { id: formId },
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
    });

    if (!form) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    res.json({ form });
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
      country,
      currency,
      regions,
      packages,
      upsells,
      isActive,
      pixelConfig,
      redirectUrl,
      allowedOrigins
    } = req.body;

    const designValidation = validateDesign(design);
    if (!designValidation.ok) {
      res.status(400).json({ error: 'Invalid design payload', issues: designValidation.issues });
      return;
    }

    const paymentError = await validatePaymentConfig(req.body, null, resolveTenantId(req));
    if (paymentError) {
      res.status(paymentError.status).json(paymentError.body);
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
      price: parseFloat(pkg.price) || 0,
      quantity: parseInt(pkg.quantity) || 1,
      discountType: pkg.discountType || 'none',
      discountValue: parseFloat(pkg.discountValue) || 0,
      originalPrice: pkg.originalPrice ? parseFloat(pkg.originalPrice) : null,
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
      price: parseFloat(upsell.price) || 0,
      items: upsell.items || null,
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
            country: country || 'Ghana',
            currency: currency || 'GHS',
            regions,
            isActive: isActive !== undefined ? isActive : true,
            pixelConfig: pixelConfig && typeof pixelConfig === 'object' ? pixelConfig : undefined,
            redirectUrl: redirectUrl ? String(redirectUrl).trim() : null,
            allowedOrigins: normalizeAllowedOrigins(allowedOrigins),
            ...paymentTogglePatch(req.body),
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
      country,
      currency,
      regions,
      packages,
      upsells,
      isActive,
      pixelConfig,
      redirectUrl,
      allowedOrigins
    } = req.body;

    const designValidation = validateDesign(design);
    if (!designValidation.ok) {
      res.status(400).json({ error: 'Invalid design payload', issues: designValidation.issues });
      return;
    }

    // Check if form exists
    const existing = await prisma.checkoutForm.findUnique({
      where: { id: formId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    const paymentError = await validatePaymentConfig(req.body, existing, resolveTenantId(req));
    if (paymentError) {
      res.status(paymentError.status).json(paymentError.body);
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

    // If product is being changed, check if it exists
    if (productId && productId !== existing.productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId }
      });

      if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
    }

    // Update form
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (productId !== undefined) updateData.productId = productId;
    if (description !== undefined) updateData.description = description;
    if (fields !== undefined) updateData.fields = fields;
    if (styling !== undefined) updateData.styling = styling;
    if (design !== undefined) updateData.design = designValidation.value;
    if (country !== undefined) updateData.country = country;
    if (currency !== undefined) updateData.currency = currency;
    if (regions !== undefined) updateData.regions = regions;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (pixelConfig !== undefined) updateData.pixelConfig = pixelConfig && typeof pixelConfig === 'object' ? pixelConfig : null;
    if (redirectUrl !== undefined) updateData.redirectUrl = redirectUrl ? String(redirectUrl).trim() : null;
    if (allowedOrigins !== undefined) updateData.allowedOrigins = normalizeAllowedOrigins(allowedOrigins);
    Object.assign(updateData, paymentTogglePatch(req.body));

    await prisma.checkoutForm.update({
      where: { id: formId },
      data: updateData
    });

    // Update packages if provided
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
    const updatedForm = await prisma.checkoutForm.findUnique({
      where: { id: formId },
      include: {
        product: true,
        packages: {
          orderBy: { sortOrder: 'asc' }
        },
        upsells: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    res.json({ form: updatedForm });
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

export const deleteCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const formId = parseInt(id, 10);

    if (isNaN(formId)) {
      res.status(400).json({ message: 'Invalid form ID' });
      return;
    }

    const form = await prisma.checkoutForm.findUnique({
      where: { id: formId },
      include: {
        _count: {
          select: { submissions: true }
        }
      }
    });

    if (!form) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    // Prevent deletion if there are submissions
    if (form._count.submissions > 0) {
      res.status(400).json({
        error: 'Cannot delete form with existing submissions. Deactivate instead.'
      });
      return;
    }

    await prisma.checkoutForm.delete({
      where: { id: formId }
    });

    // Drop any cached embed config so the widget stops serving a deleted form.
    clearCheckoutFormConfigCache(form.slug);

    res.json({ message: 'Checkout form deleted successfully' });
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

export const getFormStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const formId = parseInt(id, 10);

    if (isNaN(formId)) {
      res.status(400).json({ message: 'Invalid form ID' });
      return;
    }

    const { startDate, endDate } = req.query;

    const form = await prisma.checkoutForm.findUnique({
      where: { id: formId }
    });

    if (!form) {
      res.status(404).json({ error: 'Checkout form not found' });
      return;
    }

    const where: any = { formId: formId };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        const start = new Date(startDate as string);
        if (isNaN(start.getTime())) { res.status(400).json({ error: 'Invalid startDate' }); return; }
        where.createdAt.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate as string);
        if (isNaN(end.getTime())) { res.status(400).json({ error: 'Invalid endDate' }); return; }
        where.createdAt.lte = end;
      }
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

    res.json({
      stats: {
        totalSubmissions: submissions,
        conversions: submissionsWithOrders,
        conversionRate: parseFloat(conversionRate.toFixed(2)),
        totalRevenue: totalRevenue._sum.totalAmount || 0,
        averageOrderValue: submissions > 0 ? (totalRevenue._sum.totalAmount || 0) / submissions : 0
      }
    });
  } catch (error) {
    throw error;
  }
};
