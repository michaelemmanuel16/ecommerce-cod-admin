import { Response, Request, NextFunction } from 'express';
import { PrismaClient, OrderStatus } from '@prisma/client';
import workflowService from '../services/workflowService';
import checkoutFormService from '../services/checkoutFormService';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderCreated } from '../sockets';

const prisma = new PrismaClient();

export const getPublicForm = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;
    const form = await checkoutFormService.getCheckoutFormBySlug(slug);
    res.json({ form });
  } catch (error) {
    next(error);
  }
};

export const createPublicOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;
    const {
      formData,
      selectedPackage,
      selectedUpsells,
      totalAmount
    } = req.body;

    // Get form with product
    const form = await prisma.checkoutForm.findFirst({
      where: {
        slug: slug,
        isActive: true
      },
      include: {
        product: true
      }
    });

    if (!form) {
      res.status(404).json({ error: 'Form not found' });
      return;
    }

    if (!form.product.isActive) {
      res.status(400).json({ error: 'Product is no longer available' });
      return;
    }

    // Validate required fields
    const requiredFields = ['name', 'phoneNumber', 'address', 'state'];
    for (const field of requiredFields) {
      if (!formData[field]) {
        res.status(400).json({ error: `Missing required field: ${field}` });
        return;
      }
    }

    // Check if customer exists or create new one
    let customer = await prisma.customer.findUnique({
      where: { phoneNumber: formData.phoneNumber }
    });

    if (!customer) {
      const nameParts = formData.name.split(' ');
      const firstName = nameParts[0] || formData.name;
      const lastName = nameParts.slice(1).join(' ') || '';

      customer = await prisma.customer.create({
        data: {
          firstName,
          lastName,
          phoneNumber: formData.phoneNumber,
          email: formData.email || null,
          alternatePhone: formData.alternatePhone || null,
          address: formData.address,
          state: formData.state,
          area: formData.state,
          landmark: formData.landmark || null,
          notes: formData.notes || null
        }
      });
    }

    // Calculate package pricing
    // Package price is the total bundle price (what customer pays)
    // Quantity is what customer receives
    const packageQuantity = selectedPackage.quantity || 1;
    const packagePrice = selectedPackage.price;
    const packageTotal = packagePrice; // NOT price * quantity
    const unitPrice = packagePrice / packageQuantity; // Effective per-item price

    // Calculate upsells total
    let upsellsTotal = 0;
    if (selectedUpsells && Array.isArray(selectedUpsells)) {
      upsellsTotal = selectedUpsells.reduce((sum: number, upsell: any) => sum + upsell.price, 0);
    }

    const subtotal = packageTotal + upsellsTotal;
    const shippingCost = 0; // Can be calculated based on region
    const discount = 0;
    const finalTotal = subtotal + shippingCost - discount;

    // Validate total amount
    if (Math.abs(finalTotal - totalAmount) > 0.01) {
      res.status(400).json({ error: 'Total amount mismatch' });
      return;
    }

    // Prepare order items array: main package + upsells
    const orderItemsData = [];

    // 1. Add main package as order item
    orderItemsData.push({
      productId: form.productId,
      quantity: packageQuantity,
      unitPrice: unitPrice,
      totalPrice: packageTotal,
      itemType: 'package',
      metadata: {
        packageName: selectedPackage.name,
        originalPrice: selectedPackage.originalPrice,
        discountType: selectedPackage.discountType,
        discountValue: selectedPackage.discountValue
      }
    });

    // 2. Add upsells as order items
    if (selectedUpsells && Array.isArray(selectedUpsells)) {
      for (const upsell of selectedUpsells) {
        // Use upsell's productId if available, otherwise fallback to form's productId
        const upsellProductId = upsell.productId || form.productId;
        const upsellQuantity = upsell.items?.quantity || 1;

        orderItemsData.push({
          productId: upsellProductId,
          quantity: upsellQuantity,
          unitPrice: upsell.price / upsellQuantity,
          totalPrice: upsell.price,
          itemType: 'upsell',
          metadata: {
            upsellName: upsell.name,
            upsellDescription: upsell.description,
            originalPrice: upsell.originalPrice,
            discountType: upsell.discountType,
            discountValue: upsell.discountValue
          }
        });
      }
    }

    // Create order
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        status: OrderStatus.pending_confirmation,
        subtotal,
        shippingCost,
        discount,
        totalAmount: finalTotal,
        codAmount: finalTotal,
        deliveryAddress: formData.address,
        deliveryState: formData.state,
        deliveryArea: formData.state,
        notes: formData.notes || null,
        source: 'checkout_form',
        orderItems: {
          create: orderItemsData
        }
      },
      include: {
        customer: true,
        orderItems: {
          include: {
            product: true
          }
        }
      }
    });

    // Create form submission
    await prisma.formSubmission.create({
      data: {
        formId: form.id,
        orderId: order.id,
        formData,
        selectedPackage,
        selectedUpsells,
        totalAmount: finalTotal,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }
    });

    // Update customer totals
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        totalOrders: { increment: 1 },
        totalSpent: { increment: finalTotal }
      }
    });

    // Trigger workflows (non-blocking)
    workflowService.triggerOrderCreatedWorkflows(order).catch(err => {
      console.error('Failed to trigger workflow for public order:', err);
    });

    // Emit socket event for real-time update
    emitOrderCreated(getSocketInstance() as any, order);

    res.status(201).json({
      success: true,
      orderId: order.id,
      order: {
        id: order.id,
        totalAmount: order.totalAmount,
        status: order.status
      },
      message: 'Order created successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const trackOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderId, phoneNumber } = req.body;

    if (!orderId || !phoneNumber) {
      res.status(400).json({ error: 'Order ID and phone number are required' });
      return;
    }

    const order = await prisma.order.findFirst({
      where: {
        id: parseInt(orderId as string),
        customer: {
          phoneNumber: phoneNumber as string
        }
      },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            phoneNumber: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                imageUrl: true
              }
            }
          }
        },
        orderHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json({
      order: {
        id: order.id,
        status: order.status,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        estimatedDelivery: order.estimatedDelivery,
        customer: order.customer,
        items: order.orderItems.map(item => ({
          name: item.product.name,
          quantity: item.quantity,
          price: item.unitPrice,
          total: item.totalPrice,
          imageUrl: item.product.imageUrl
        })),
        history: order.orderHistory.map(h => ({
          status: h.status,
          notes: h.notes,
          createdAt: h.createdAt
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};
