import prisma from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { AppError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import * as Money from '../utils/money';
import { townsForForm } from './locationService';
import { isUpsellAvailable } from '../utils/checkoutFormRules';
import { storageHost } from '../config/r2';

// Shared PUBLIC render payload — the fields safe to expose on the public
// checkout page and the embed widget config endpoint. Reused so the page and
// the widget never drift in what they receive.
const PUBLIC_FORM_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  fields: true,
  design: true,
  country: true,
  currency: true,
  regions: true,
  pixelConfig: true,
  redirectUrl: true,
  formType: true,
  codEnabled: true,
  paystackDepositEnabled: true,
  paystackFullEnabled: true,
  depositPercent: true,
  product: {
    select: {
      name: true,
      description: true,
      price: true,
      imageUrl: true,
      stockQuantity: true,
      productType: true,
    },
  },
  packages: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      quantity: true,
      originalPrice: true,
      discountType: true,
      discountValue: true,
      isPopular: true,
      isDefault: true,
      showHighlight: true,
      highlightText: true,
      showDiscount: true,
    },
  },
  upsells: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      price: true,
      items: true,
      originalPrice: true,
      discountType: true,
      discountValue: true,
      // Read to hide an upsell whose product is inactive or out of stock; removed again before the response.
      productId: true,
      product: { select: { isActive: true, stockQuantity: true, productType: true } },
    },
  },
} satisfies Prisma.CheckoutFormSelect;

type UpsellRow = Parameters<typeof isUpsellAvailable>[0];

// Replace the raw stock quantity with a boolean in-stock flag.
// `towns` (state -> towns) is added so the public form can fill its City/Town dropdown (COD-138).
// Upsells whose linked product is inactive or out of stock are dropped (F-415).
function sanitizePublicForm<T extends { product: { stockQuantity: number }; country: string | null; regions: unknown; upsells: UpsellRow[] }>(form: T) {
  const { stockQuantity, ...productData } = form.product;
  const upsells = form.upsells.filter(isUpsellAvailable).map(({ productId: _productId, product: _product, ...visible }: any) => visible);
  return { ...form, upsells, product: { ...productData, inStock: stockQuantity > 0 }, towns: townsForForm(form.country, form.regions), storageHost: storageHost() };
}

// ---------- Public embed config cache ----------
// The embed widget's GET /api/public/forms/:slug/config is hit on every
// host-page load. Cache the DB form read for 5 minutes, keyed by slug,
// invalidated whenever the form is saved (see clearCheckoutFormConfigCache).
const CONFIG_CACHE_TTL_MS = 5 * 60_000;
const configCache = new Map<string, { data: any; fetchedAt: number }>();

export function clearCheckoutFormConfigCache(slug?: string): void {
  if (slug) {
    configCache.delete(slug);
  } else {
    configCache.clear();
  }
}


interface CreateCheckoutFormData {
  name: string;
  slug: string;
  productId: number;
  description?: string;
  fields: any;
  styling: any;
  country?: string;
  regions: any;
  packages: Array<{
    name: string;
    description?: string;
    price: Money.MoneyInput;
    quantity: number;
    isPopular?: boolean;
    sortOrder?: number;
  }>;
  upsells?: Array<{
    name: string;
    description?: string;
    imageUrl?: string;
    price: Money.MoneyInput;
    items: any;
    sortOrder?: number;
    productId?: number;
  }>;
}

interface UpdateCheckoutFormData {
  name?: string;
  slug?: string;
  productId?: number;
  description?: string;
  fields?: any;
  styling?: any;
  country?: string;
  regions?: any;
  isActive?: boolean;
  packages?: Array<{
    id?: number;
    name: string;
    description?: string;
    price: Money.MoneyInput;
    quantity: number;
    isPopular?: boolean;
    sortOrder?: number;
  }>;
  upsells?: Array<{
    id?: number;
    name: string;
    description?: string;
    imageUrl?: string;
    price: Money.MoneyInput;
    items: any;
    sortOrder?: number;
    productId?: number;
  }>;
}

export class CheckoutFormService {
  /**
   * Create new checkout form with packages and upsells
   */
  async createCheckoutForm(data: CreateCheckoutFormData) {

    // Check if slug already exists. Archived forms still hold their slug in the
    // unique index and are hidden by the soft-delete filter, so this lookup opts
    // out — otherwise the create below dies on the constraint with a 500.
    const existingForm = await withSoftDeleted(() =>
      prisma.checkoutForm.findFirst({
        where: { slug: data.slug }
      })
    );

    if (existingForm) {
      throw new AppError(
        existingForm.archivedAt
          ? 'An archived checkout form already uses this slug. Restore it or pick another slug.'
          : 'Checkout form with this slug already exists',
        400
      );
    }

    // Validate product exists
    const product = await prisma.product.findUnique({
      where: { id: data.productId }
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    // Create form with packages and upsells in transaction
    const form = await prisma.$transaction(async (tx) => {
      const newForm = await tx.checkoutForm.create({
        data: {
          name: data.name,
          slug: data.slug,
          productId: data.productId,
          description: data.description,
          fields: data.fields,
          styling: data.styling,
          country: data.country || 'Ghana',
          regions: data.regions,
                    packages: {
            create: data.packages.map((pkg) => ({
              name: pkg.name,
              description: pkg.description,
              price: pkg.price,
              quantity: pkg.quantity,
              isPopular: pkg.isPopular || false,
              sortOrder: pkg.sortOrder || 0
            }))
          },
          upsells: data.upsells
            ? {
              create: data.upsells.map((upsell) => ({
                name: upsell.name,
                description: upsell.description,
                imageUrl: upsell.imageUrl,
                price: upsell.price,
                items: upsell.items,
                sortOrder: upsell.sortOrder || 0
              }))
            }
            : undefined
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              price: true
            }
          },
          packages: {
            orderBy: { sortOrder: 'asc' }
          },
          upsells: {
            orderBy: { sortOrder: 'asc' }
          }
        }
      });

      return newForm;
    });

    logger.info('Checkout form created', {
      formId: form.id,
      slug: form.slug,
      packagesCount: data.packages.length,
      upsellsCount: data.upsells?.length || 0
    });

    return form;
  }

  /**
   * Get all checkout forms with packages and upsells
   */
  async getAllCheckoutForms(filters?: { isActive?: boolean }) {

    const where: Prisma.CheckoutFormWhereInput = {};

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    const forms = await prisma.checkoutForm.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            price: true
          }
        },
        packages: {
          orderBy: { sortOrder: 'asc' }
        },
        upsells: {
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: {
            submissions: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return forms;
  }

  /**
   * Get checkout form by ID with all relations
   */
  async getCheckoutFormById(formId: string) {
    const form = await prisma.checkoutForm.findUnique({
      where: { id: parseInt(formId, 10) },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            stockQuantity: true
          }
        },
        packages: {
          orderBy: { sortOrder: 'asc' }
        },
        upsells: {
          orderBy: { sortOrder: 'asc' }
        },
        submissions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            totalAmount: true,
            createdAt: true,
            order: {
              select: {
                // orderNumber removed - using id
                status: true
              }
            }
          }
        }
      }
    });

    if (!form) {
      throw new AppError('Checkout form not found', 404);
    }

    return form;
  }

  /**
   * Get PUBLIC checkout form by slug (for public form page)
   * Only returns active forms with minimal data
   */
  async getCheckoutFormBySlug(slug: string) {
    const form = await prisma.checkoutForm.findUnique({
      where: {
        slug,
        isActive: true
      },
      select: PUBLIC_FORM_SELECT
    });

    if (!form) {
      throw new AppError('Checkout form not found or inactive', 404);
    }

    // Sanitize product data: hide exact stock quantity, return status
    return sanitizePublicForm(form);
  }

  /**
   * PUBLIC embed config by slug (for the embed widget's
   * GET /api/public/forms/:slug/config). Same render payload as
   * getCheckoutFormBySlug, plus `tenantId` and the per-form `allowedOrigins`
   * allowlist, and the form's `paymentProvider` — all consumed by the controller (tenant + provider → public key,
   * allowlist → Origin 403 gate) and stripped before the response reaches the
   * host page. The DB read is cached 5 min, invalidated on form save.
   */
  async getCheckoutFormConfigBySlug(slug: string) {
    const now = Date.now();
    const cached = configCache.get(slug);
    if (cached && now - cached.fetchedAt < CONFIG_CACHE_TTL_MS) {
      return cached.data;
    }

    const form = await prisma.checkoutForm.findUnique({
      where: { slug, isActive: true },
      select: { ...PUBLIC_FORM_SELECT, tenantId: true, allowedOrigins: true, paymentProvider: true }
    });

    if (!form) {
      throw new AppError('Checkout form not found or inactive', 404);
    }

    const sanitized = sanitizePublicForm(form);
    configCache.set(slug, { data: sanitized, fetchedAt: now });
    return sanitized;
  }

  /**
   * ADMIN preview by ID — returns the render-shape payload for any form
   * (including drafts / inactive). Caller is responsible for verifying
   * admin auth + tenant scope.
   */
  async getCheckoutFormForPreview(id: number, tenantId?: string | null) {
    const where: Prisma.CheckoutFormWhereInput = { id };
    // Guard explicitly: empty-string tenantId from a misconfigured token must
    // not skip the scope filter and leak cross-tenant data.
    if (tenantId != null && tenantId !== '') where.tenantId = tenantId;
    // Drafts and inactive forms preview too, so opt out of the isActive filter.
    const form = await withSoftDeleted(() => prisma.checkoutForm.findFirst({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        fields: true,
        design: true,
        country: true,
        currency: true,
        regions: true,
        pixelConfig: true,
        formType: true,
        product: {
          select: {
            name: true,
            description: true,
            price: true,
            imageUrl: true,
            stockQuantity: true,
            productType: true,
          },
        },
        packages: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            quantity: true,
            originalPrice: true,
            discountType: true,
            discountValue: true,
            isPopular: true,
            isDefault: true,
            showHighlight: true,
            highlightText: true,
            showDiscount: true,
          },
        },
        upsells: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            price: true,
            items: true,
            originalPrice: true,
            discountType: true,
            discountValue: true,
          },
        },
      },
    }));

    if (!form) {
      throw new AppError('Checkout form not found', 404);
    }

    const { stockQuantity, ...productData } = form.product;
    return {
      ...form,
      // An upsell switched off in the editor is hidden here as on the public form.
      upsells: form.upsells.filter(isUpsellAvailable),
      product: { ...productData, inStock: stockQuantity > 0 },
      towns: townsForForm(form.country, form.regions),
      storageHost: storageHost(),
    };
  }

  /**
   * Update checkout form with packages and upsells
   */
  async updateCheckoutForm(formId: string, data: UpdateCheckoutFormData) {
    const formIdNum = parseInt(formId, 10);
    const existingForm = await prisma.checkoutForm.findUnique({
      where: { id: formIdNum },
      include: {
        packages: true,
        upsells: true
      }
    });

    if (!existingForm) {
      throw new AppError('Checkout form not found', 404);
    }

    // If updating slug, check for duplicates
    if (data.slug && data.slug !== existingForm.slug) {
      // Archived forms included — see createCheckoutForm.
      const slugExists = await withSoftDeleted(() =>
        prisma.checkoutForm.findFirst({
          where: { slug: data.slug }
        })
      );

      if (slugExists) {
        throw new AppError(
          slugExists.archivedAt
            ? 'An archived checkout form already uses this slug. Restore it or pick another slug.'
            : 'Slug already in use',
          400
        );
      }
    }

    // If updating product, validate it exists
    if (data.productId && data.productId !== existingForm.productId) {
      const product = await prisma.product.findUnique({
        where: { id: data.productId }
      });

      if (!product) {
        throw new AppError('Product not found', 404);
      }
    }

    // Update form with packages and upsells in transaction
    const updated = await prisma.$transaction(async (tx) => {
      // Handle packages update
      if (data.packages) {
        // Delete packages that are not in the update
        const packageIdsToKeep = data.packages
          .filter((pkg) => pkg.id)
          .map((pkg) => pkg.id!);

        await tx.formPackage.deleteMany({
          where: {
            formId: formIdNum,
            id: packageIdsToKeep.length > 0 ? { notIn: packageIdsToKeep } : undefined
          }
        });

        // Update or create packages
        for (const pkg of data.packages) {
          if (pkg.id) {
            // Update existing package
            // formId ties the child to existingForm, which the tenant-scoped lookup above verified
            await tx.formPackage.update({
              where: { id: pkg.id, formId: formIdNum },
              data: {
                name: pkg.name,
                description: pkg.description,
                price: pkg.price,
                quantity: pkg.quantity,
                isPopular: pkg.isPopular,
                sortOrder: pkg.sortOrder
              }
            });
          } else {
            // Create new package
            await tx.formPackage.create({
              data: {
                formId: formIdNum,
                name: pkg.name,
                description: pkg.description,
                price: pkg.price,
                quantity: pkg.quantity,
                isPopular: pkg.isPopular || false,
                sortOrder: pkg.sortOrder || 0
              }
            });
          }
        }
      }

      // Handle upsells update
      if (data.upsells) {
        // Delete upsells that are not in the update
        const upsellIdsToKeep = data.upsells
          .filter((upsell) => upsell.id)
          .map((upsell) => upsell.id!);

        await tx.formUpsell.deleteMany({
          where: {
            formId: formIdNum,
            id: upsellIdsToKeep.length > 0 ? { notIn: upsellIdsToKeep } : undefined
          }
        });

        // Update or create upsells
        for (const upsell of data.upsells) {
          if (upsell.id) {
            // Update existing upsell
            await tx.formUpsell.update({
              where: { id: upsell.id, formId: formIdNum },
              data: {
                name: upsell.name,
                description: upsell.description,
                imageUrl: upsell.imageUrl,
                price: upsell.price,
                items: upsell.items,
                sortOrder: upsell.sortOrder
              }
            });
          } else {
            // Create new upsell
            await tx.formUpsell.create({
              data: {
                formId: formIdNum,
                name: upsell.name,
                description: upsell.description,
                imageUrl: upsell.imageUrl,
                price: upsell.price,
                items: upsell.items,
                sortOrder: upsell.sortOrder || 0
              }
            });
          }
        }
      }

      // Update form basic fields
      const { packages, upsells, ...formData } = data;
      const updatedForm = await tx.checkoutForm.update({
        where: { id: formIdNum },
        data: formData,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              price: true
            }
          },
          packages: {
            orderBy: { sortOrder: 'asc' }
          },
          upsells: {
            orderBy: { sortOrder: 'asc' }
          }
        }
      });

      return updatedForm;
    });

    logger.info('Checkout form updated', { formId, slug: updated.slug });
    return updated;
  }

  /**
   * Delete checkout form (soft delete by deactivating)
   */
  async deleteCheckoutForm(formId: string) {
    const formIdNum = parseInt(formId, 10);
    const form = await prisma.checkoutForm.findUnique({
      where: { id: formIdNum }
    });

    if (!form) {
      throw new AppError('Checkout form not found', 404);
    }

    // Check if form has submissions
    const submissionCount = await prisma.formSubmission.count({
      where: { formId: formIdNum }
    });

    if (submissionCount > 0) {
      // Soft delete if has submissions
      await prisma.checkoutForm.update({
        where: { id: formIdNum },
        data: { isActive: false }
      });

      logger.info('Checkout form deactivated (has submissions)', {
        formId,
        slug: form.slug,
        submissionCount
      });

      return {
        message: 'Checkout form deactivated successfully',
        note: 'Form has submissions and was deactivated instead of deleted'
      };
    } else {
      // Hard delete if no submissions (packages and upsells will cascade)
      await prisma.checkoutForm.delete({
        where: { id: formIdNum }
      });

      logger.info('Checkout form deleted', { formId, slug: form.slug });
      return { message: 'Checkout form deleted successfully' };
    }
  }

  /**
   * Get form statistics
   */
  async getFormStats(formId: string) {
    const formIdNum = parseInt(formId, 10);
    const form = await prisma.checkoutForm.findUnique({
      where: { id: formIdNum }
    });

    if (!form) {
      throw new AppError('Checkout form not found', 404);
    }

    const [submissions, totalRevenue, packageStats] = await Promise.all([
      prisma.formSubmission.count({ where: { formId: formIdNum } }),
      prisma.formSubmission.aggregate({
        where: { formId: formIdNum },
        _sum: { totalAmount: true }
      }),
      prisma.formSubmission.groupBy({
        by: ['selectedPackage'],
        where: { formId: formIdNum },
        _count: true
      })
    ]);

    const revenue = totalRevenue._sum?.totalAmount ?? Money.ZERO;
    const stats = {
      totalSubmissions: submissions,
      totalRevenue: Money.toApi(revenue),
      averageOrderValue: submissions > 0 ? Money.toApi(Money.div(revenue, submissions)) : Money.toApi(0),
      packageBreakdown: packageStats
    };

    return stats;
  }
}

export default new CheckoutFormService();
