import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

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

    // Validate selected package
    const selectedPackage = form.packages.find(
      (pkg) => pkg.id === orderData.selectedPackageId
    );

    if (!selectedPackage) {
      throw new AppError('Invalid package selection', 400);
    }

    // Validate product stock
    const totalQuantity = selectedPackage.quantity;
    if (form.product.stockQuantity < totalQuantity) {
      throw new AppError(
        `Insufficient stock. Available: ${form.product.stockQuantity}`,
        400
      );
    }

    // Validate and calculate upsells
    let selectedUpsells: Array<{ id: string; name: string; price: number; items: any; productId: number | null }> = [];
    let upsellsTotal = 0;

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
        upsellsTotal += upsell.price;
      }
    }

    // Calculate total
    const subtotal = selectedPackage.price;
    const totalAmount = subtotal + upsellsTotal;

    // Find or create customer
    let customer = await prisma.customer.findUnique({
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
            price: selectedPackage.price,
            quantity: selectedPackage.quantity
          },
          selectedUpsells:
            selectedUpsells.length > 0
              ? selectedUpsells.map((u) => ({
                  id: u.id,
                  name: u.name,
                  price: u.price
                }))
              : undefined,
          totalAmount,
          ipAddress: orderData.ipAddress,
          userAgent: orderData.userAgent
        }
      });

      // Update product stock
      await tx.product.update({
        where: { id: form.productId },
        data: {
          stockQuantity: {
            decrement: selectedPackage.quantity
          }
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
      totalAmount,
      packageName: selectedPackage.name,
      upsellsCount: selectedUpsells.length
    });

    return {
      orderId: result.id,
      totalAmount,
      customer: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phoneNumber: customer.phoneNumber
      },
      package: {
        name: selectedPackage.name,
        quantity: selectedPackage.quantity,
        price: selectedPackage.price
      },
      upsells: selectedUpsells.map((u) => ({
        name: u.name,
        price: u.price
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

export default new PublicOrderService();
