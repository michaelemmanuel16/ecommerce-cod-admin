import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import { OrderStatus, Prisma } from '@prisma/client';
import * as Money from '../utils/money';
import { normalizeOrderRegion } from './regionService';
import { getAvailableToSell } from './stockService';
import { customerNeedsManualCall } from './refusalRuleService';
import { emitOrderCreatedEvent } from '../utils/appEvents';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderCreated } from '../sockets';
import { metaCapiService } from './metaCapiService';
import { deliveryAddressOf } from '../utils/checkoutLocation';

interface PublicOrderData {
  // Customer info
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email?: string;
  alternatePhone?: string;

  // Delivery info
  deliveryAddress: string;
  deliveryState: string;
  deliveryArea: string;
  landmark?: string;

  // Order selections
  selectedPackageId: number;
  selectedUpsellIds?: number[];
  notes?: string;

  // Tracking
  ipAddress?: string;
  userAgent?: string;
}

export class PublicOrderService {
  /**
   * Create order from public checkout form submission
   */
  async createPublicOrder(formSlug: string, orderData: PublicOrderData) {
    // Get form with packages and upsells
    const form = await prisma.checkoutForm.findUnique({
      where: {
        slug: formSlug,
        isActive: true
      },
      include: {
        product: true,
        packages: true,
        upsells: true
      }
    });

    if (!form) {
      throw new AppError('Checkout form not found or inactive', 404);
    }

    // O3: the region is a value of the store country's list; an unknown one stays as typed
    orderData = { ...orderData, deliveryState: await normalizeOrderRegion(orderData.deliveryState, form.tenantId) };

    // Validate selected package
    const selectedPackage = form.packages.find(
      (pkg) => pkg.id === orderData.selectedPackageId
    );

    if (!selectedPackage) {
      throw new AppError('Invalid package selection', 400);
    }

    // Validate product stock: available to sell (on hand less reserved, F-651). A digital product has none.
    const totalQuantity = selectedPackage.quantity;
    if (form.product.productType !== 'digital') {
      const available = await getAvailableToSell(form.productId);
      if (available < totalQuantity) {
        throw new AppError(
          `Insufficient stock. Available: ${Math.max(available, 0)}`,
          400
        );
      }
    }

    // Validate and calculate upsells
    let selectedUpsells: Array<{ id: string; name: string; price: Prisma.Decimal; items: any; productId: number | null }> = [];
    let upsellsTotal: Prisma.Decimal = Money.ZERO;

    if (orderData.selectedUpsellIds && orderData.selectedUpsellIds.length > 0) {
      for (const upsellId of orderData.selectedUpsellIds) {
        const upsell = form.upsells.find((u) => u.id === upsellId);
        if (!upsell) {
          throw new AppError(`Invalid upsell selection: ${upsellId}`, 400);
        }
        selectedUpsells.push({
          id: upsell.id.toString(),
          name: upsell.name,
          price: upsell.price,
          items: upsell.items,
          productId: upsell.productId
        });
        upsellsTotal = Money.add(upsellsTotal, upsell.price);
      }
    }

    // Calculate total
    const subtotal = selectedPackage.price;
    const totalAmount = Money.roundHalfUp(Money.add(subtotal, upsellsTotal), 2);

    // Dedup guard: prevent double-submits within 30 minutes (same phone + package + total)
    // Run before any customer mutations so side-effects don't occur on duplicate requests
    {
      const dedupeFrom = new Date(Date.now() - 30 * 60 * 1000);
      const existingOrder = await prisma.order.findFirst({
        where: {
          source: 'checkout_form',
          totalAmount,
          deletedAt: null,
          createdAt: { gte: dedupeFrom },
          customer: { phoneNumber: orderData.phoneNumber },
          orderItems: {
            some: {
              itemType: 'package',
              metadata: { path: ['packageId'], equals: orderData.selectedPackageId }
            }
          }
        },
        select: { id: true }
      });

      if (existingOrder) {
        logger.info('Skipping duplicate checkout form order (same phone+package+total within 30 min)', {
          existingOrderId: existingOrder.id,
          phone: orderData.phoneNumber,
          packageId: orderData.selectedPackageId,
          totalAmount: Money.toApi(totalAmount)
        });
        return {
          orderId: existingOrder.id,
          totalAmount: Money.toApi(totalAmount),
          customer: {
            firstName: orderData.firstName,
            lastName: orderData.lastName,
            phoneNumber: orderData.phoneNumber
          },
          package: {
            name: selectedPackage.name,
            quantity: selectedPackage.quantity,
            price: Money.toApi(selectedPackage.price)
          },
          upsells: []
        };
      }
    }

    // Find or create customer
    let customer = await prisma.customer.findFirst({
      where: { phoneNumber: orderData.phoneNumber }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          firstName: orderData.firstName,
          lastName: orderData.lastName,
          phoneNumber: orderData.phoneNumber,
          email: orderData.email,
          alternatePhone: orderData.alternatePhone,
          address: orderData.deliveryAddress,
          state: orderData.deliveryState,
          area: orderData.deliveryArea,
          landmark: orderData.landmark,
          tags: ['checkout-form']
        }
      });

      logger.info('New customer created from checkout form', {
        customerId: customer.id,
        phoneNumber: customer.phoneNumber,
        formSlug
      });
    } else {
      // Update customer info if needed
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          email: orderData.email || customer.email,
          alternatePhone: orderData.alternatePhone || customer.alternatePhone,
          landmark: orderData.landmark || customer.landmark
        }
      });
    }

    // Create order with form submission in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create order
      const order = await tx.order.create({
        data: {
          customerId: customer.id,
          subtotal,
          totalAmount,
          codAmount: totalAmount,
          requiresManualCall: customerNeedsManualCall(customer),
          deliveryAddress: orderData.deliveryAddress,
          deliveryState: orderData.deliveryState,
          deliveryArea: orderData.deliveryArea,
          notes: orderData.notes,
          source: 'checkout_form',
          tags: ['checkout-form', formSlug],
          orderItems: {
            create: [
              // Main package item
              {
                productId: form.productId,
                quantity: selectedPackage.quantity,
                unitPrice: form.product.price,
                totalPrice: selectedPackage.price,
                itemType: 'package',
                metadata: {
                  packageName: selectedPackage.name,
                  packageId: selectedPackage.id
                }
              },
              // Upsell items
              ...selectedUpsells.map((upsell) => ({
                productId: upsell.productId || form.productId, // Use form's productId as fallback
                quantity: 1,
                unitPrice: upsell.price,
                totalPrice: upsell.price,
                itemType: 'upsell',
                metadata: {
                  upsellName: upsell.name,
                  upsellId: upsell.id,
                  items: upsell.items
                }
              }))
            ]
          },
          orderHistory: {
            create: {
              tenantId: resolveTenantId(form.tenantId),
              status: 'pending_confirmation',
              notes: `Order created from checkout form: ${form.name}`,
              metadata: {
                formSlug,
                packageName: selectedPackage.name,
                upsells: selectedUpsells.map((u) => u.name)
              }
            }
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

      // Create form submission record
      await tx.formSubmission.create({
        data: {
          tenantId: resolveTenantId(form.tenantId),
          formId: form.id,
          orderId: order.id,
          formData: {
            firstName: orderData.firstName,
            lastName: orderData.lastName,
            phoneNumber: orderData.phoneNumber,
            email: orderData.email,
            deliveryAddress: orderData.deliveryAddress,
            deliveryState: orderData.deliveryState,
            deliveryArea: orderData.deliveryArea,
            landmark: orderData.landmark,
            notes: orderData.notes
          },
          selectedPackage: {
            id: selectedPackage.id,
            name: selectedPackage.name,
            price: Money.toApi(selectedPackage.price),
            quantity: selectedPackage.quantity
          },
          selectedUpsells:
            selectedUpsells.length > 0
              ? selectedUpsells.map((u) => ({
                  id: u.id,
                  name: u.name,
                  price: Money.toApi(u.price)
                }))
              : undefined,
          totalAmount,
          ipAddress: orderData.ipAddress,
          userAgent: orderData.userAgent
        }
      });

      // Update customer stats
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          totalOrders: { increment: 1 },
          totalSpent: { increment: totalAmount }
        }
      });

      return order;
    });

    logger.info('Public order created from checkout form', {
      orderId: result.id,
      formSlug,
      customerId: customer.id,
      totalAmount: Money.toApi(totalAmount),
      packageName: selectedPackage.name,
      upsellsCount: selectedUpsells.length
    });

    return {
      orderId: result.id,
      totalAmount: Money.toApi(totalAmount),
      customer: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phoneNumber: customer.phoneNumber
      },
      package: {
        name: selectedPackage.name,
        quantity: selectedPackage.quantity,
        price: Money.toApi(selectedPackage.price)
      },
      upsells: selectedUpsells.map((u) => ({
        name: u.name,
        price: Money.toApi(u.price)
      }))
    };
  }

  /**
   * Get public order status by order ID (for customer tracking)
   */
  async getPublicOrderStatus(orderId: number, phoneNumber: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        customer: {
          phoneNumber
        }
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        estimatedDelivery: true,
        orderItems: {
          select: {
            quantity: true,
            product: {
              select: {
                name: true,
                imageUrl: true
              }
            }
          }
        },
        delivery: {
          select: {
            scheduledTime: true,
            actualDeliveryTime: true,
            agent: {
              select: {
                firstName: true,
                lastName: true,
                phoneNumber: true
              }
            }
          }
        }
      }
    });

    if (!order) {
      throw new AppError('Order not found or phone number does not match', 404);
    }

    return order;
  }

  /**
   * Verify form submission exists
   */
  async getFormSubmission(orderId: string) {
    const submission = await prisma.formSubmission.findFirst({
      where: { orderId: parseInt(orderId, 10) },
      include: {
        form: {
          select: {
            name: true,
            slug: true
          }
        }
      }
    });

    if (!submission) {
      throw new AppError('Form submission not found', 404);
    }

    return submission;
  }
}

/** What the public checkout resolved for a cash-on-delivery order. The controller validates; this service writes. */
export interface CodCheckoutOrderInput {
  customer: Parameters<typeof customerNeedsManualCall>[0] & { id: number };
  formId: number;
  formTenantId: string | null;
  isDigital: boolean;
  paymentMethod: any;
  subtotal: Prisma.Decimal;
  shippingCost: Prisma.Decimal;
  discount: Prisma.Decimal;
  finalTotal: Prisma.Decimal;
  formData: any;
  landmark: string | null | undefined;
  area: string | null | undefined;
  selectedPackage: unknown;
  selectedUpsells: unknown;
  orderItems: Prisma.OrderItemCreateWithoutOrderInput[] | any[];
  fbp: string | null;
  fbc: string | null;
  ip: string | undefined;
  userAgent: string | undefined;
}

/**
 * The public checkout's cash-on-delivery write (M9-T21): the order, its form submission and the customer totals,
 * then `order.created` (workflows), the socket event and the Meta Purchase event. The order is created at
 * pending_confirmation because payment settles on delivery. `order.created` fires here, after the writes, once.
 */
export async function createCodCheckoutOrder(input: CodCheckoutOrderInput) {
  const order = await prisma.order.create({
    data: {
      customerId: input.customer.id,
      status: OrderStatus.pending_confirmation,
      orderType: input.isDigital ? 'digital' : 'physical',
      paymentMethod: input.paymentMethod,
      subtotal: input.subtotal,
      shippingCost: input.shippingCost,
      discount: input.discount,
      totalAmount: input.finalTotal,
      codAmount: input.finalTotal,
      requiresManualCall: customerNeedsManualCall(input.customer),
      balanceDue: 0,
      deliveryAddress: deliveryAddressOf(input.formData.address, input.landmark),
      deliveryState: input.formData.state || null,
      deliveryArea: input.area || null,
      notes: input.formData.notes || null,
      source: 'checkout_form',
      fbp: input.fbp,
      fbc: input.fbc,
      ...(input.formTenantId ? { tenantId: input.formTenantId } : {}),
      orderItems: {
        create: input.orderItems,
      },
    },
    include: {
      customer: true,
      orderItems: {
        include: {
          product: true,
        },
      },
    },
  });

  await prisma.formSubmission.create({
    data: {
      tenantId: resolveTenantId(input.formTenantId),
      formId: input.formId,
      orderId: order.id,
      formData: input.formData,
      selectedPackage: input.selectedPackage as any,
      selectedUpsells: input.selectedUpsells as any,
      totalAmount: input.finalTotal,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    },
  });

  await prisma.customer.update({
    where: { id: input.customer.id },
    data: {
      totalOrders: { increment: 1 },
      totalSpent: { increment: input.finalTotal },
    },
  });

  // Trigger workflows (non-blocking)
  emitOrderCreatedEvent(order);

  // Emit socket event for real-time update
  emitOrderCreated(getSocketInstance() as any, order);

  // COD orders are "purchased" at creation (payment settles on delivery), so
  // fire the server-side Meta Purchase event now. Best-effort + idempotent;
  // Paystack orders fire instead on settlement (see paymentSettlementService).
  metaCapiService.fireCapiPurchaseEvent(order.id).catch((err) => {
    console.error('Meta CAPI fire failed for COD order:', err);
  });

  return order;
}

export default new PublicOrderService();
