import { Response } from 'express';
import { AuthRequest } from '../types';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

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

export const createCheckoutForm = async (req: AuthRequest, res: Response): Promise<void> => {
  console.log('=== CREATE CHECKOUT FORM START ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    const {
      name,
      slug,
      productId,
      description,
      fields,
      styling,
      country,
      currency,
      regions,
      packages,
      upsells,
      isActive
    } = req.body;

    console.log('Extracted data:', {
      name,
      slug,
      productId,
      packagesCount: packages?.length,
      upsellsCount: upsells?.length
    });

    // Check if slug already exists
    console.log('Checking for existing slug...');
    const existing = await prisma.checkoutForm.findUnique({
      where: { slug }
    });
    console.log('Existing form check complete:', existing ? 'FOUND' : 'NOT FOUND');

    if (existing) {
      res.status(400).json({ error: 'Slug already exists' });
      return;
    }

    // Check if product exists
    console.log('Checking if product exists:', productId);
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });
    console.log('Product check complete:', product ? 'FOUND' : 'NOT FOUND');

    if (!product) {
      console.log('Product not found, returning 404');
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    console.log('About to create checkout form with Prisma...');
    console.log('Packages:', JSON.stringify(packages, null, 2));
    console.log('Upsells:', JSON.stringify(upsells, null, 2));

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

    console.log('Normalized packages:', normalizedPackages);
    console.log('Normalized upsells:', normalizedUpsells);

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
            country: country || 'Ghana',
            currency: currency || 'GHS',
            regions,
            isActive: isActive !== undefined ? isActive : true,
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

    console.log('Checkout form created successfully!', form.id);
    res.status(201).json({ form });
  } catch (error: any) {
    console.error('=== CREATE CHECKOUT FORM ERROR ===');
    console.error('Error:', error);
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error?.message);

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
      country,
      currency,
      regions,
      packages,
      upsells,
      isActive
    } = req.body;

    // Check if form exists
    const existing = await prisma.checkoutForm.findUnique({
      where: { id: formId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Checkout form not found' });
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
    if (country !== undefined) updateData.country = country;
    if (currency !== undefined) updateData.currency = currency;
    if (regions !== undefined) updateData.regions = regions;
    if (isActive !== undefined) updateData.isActive = isActive;

    const form = await prisma.checkoutForm.update({
      where: { id: formId },
      data: updateData,
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
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
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
