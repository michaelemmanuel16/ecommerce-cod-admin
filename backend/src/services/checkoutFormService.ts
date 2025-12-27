import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';

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
    price: number;
    quantity: number;
    isPopular?: boolean;
    sortOrder?: number;
  }>;
  upsells?: Array<{
    name: string;
    description?: string;
    imageUrl?: string;
    price: number;
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
    price: number;
    quantity: number;
    isPopular?: boolean;
    sortOrder?: number;
  }>;
  upsells?: Array<{
    id?: number;
    name: string;
    description?: string;
    imageUrl?: string;
    price: number;
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
    // Check if slug already exists
    const existingForm = await prisma.checkoutForm.findUnique({
      where: { slug: data.slug }
    });

    if (existingForm) {
      throw new AppError('Checkout form with this slug already exists', 400);
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
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        fields: true,
        styling: true,
        country: true,
        regions: true,
        product: {
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            imageUrl: true,
            stockQuantity: true
          }
        },
        packages: {
          where: {
            // Only return packages if product is in stock
          },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            quantity: true,
            isPopular: true
          }
        },
        upsells: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            items: true
          }
        }
      }
    });

    if (!form) {
      throw new AppError('Checkout form not found or inactive', 404);
    }

    // Check if product has sufficient stock
    if (form.product.stockQuantity <= 0) {
      throw new AppError('Product is currently out of stock', 400);
    }

    return form;
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
      const slugExists = await prisma.checkoutForm.findUnique({
        where: { slug: data.slug }
      });

      if (slugExists) {
        throw new AppError('Slug already in use', 400);
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
            await tx.formPackage.update({
              where: { id: pkg.id },
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
              where: { id: upsell.id },
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

    const stats = {
      totalSubmissions: submissions,
      totalRevenue: totalRevenue._sum?.totalAmount || 0,
      averageOrderValue: submissions > 0 ? (totalRevenue._sum?.totalAmount || 0) / submissions : 0,
      packageBreakdown: packageStats
    };

    return stats;
  }
}

export default new CheckoutFormService();
