import { Response, Request, NextFunction } from 'express';
import { OrderStatus, Prisma } from '@prisma/client';
import workflowService from '../services/workflowService';
import checkoutFormService from '../services/checkoutFormService';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderCreated } from '../sockets';
import prisma from '../utils/prisma';
import { paystackService } from '../services/paystackService';
import { metaCapiService } from '../services/metaCapiService';

/**
 * Buyer-selectable payment methods. `cod` settles on delivery; the two Paystack
 * methods charge online against the form tenant's own Paystack account —
 * `paystack_full` for the whole total, `paystack_deposit` for a percentage with
 * the balance collected on delivery.
 */
type PaymentMethod = 'cod' | 'paystack_deposit' | 'paystack_full';

export const getPublicForm = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;
    const form = await checkoutFormService.getCheckoutFormBySlug(slug);
    res.json({ form });
  } catch (error) {
    next(error);
  }
};

/**
 * Embed widget config: GET /api/public/forms/:slug/config
 *
 * Returns the public form render payload plus the tenant's Paystack PUBLIC key,
 * for the JS widget dropped onto a host page. The global /api/public CORS is a
 * blanket `origin: '*'`, so the per-form Origin allowlist is enforced HERE: if
 * the form has any allowedOrigins configured and the request carries an Origin
 * that isn't on the list, we 403. An empty allowlist means "no host restriction
 * yet" (the underlying form data is already public via /forms/:slug). Requests
 * without an Origin header (non-browser / same-origin) are not gated.
 *
 * SECURITY: only the Paystack *public* key is ever returned. The secret key and
 * allowlist/tenantId are stripped before the response leaves the server.
 */
export const getPublicFormConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;
    const form = await checkoutFormService.getCheckoutFormConfigBySlug(slug);

    const { tenantId, allowedOrigins, ...publicForm } = form as typeof form & {
      tenantId: string | null;
      allowedOrigins: string[];
    };
    // Defense-in-depth: never let the server-only Meta CAPI secrets reach a host
    // page, even if a future select change starts including them.
    delete (publicForm as Record<string, unknown>).metaCapiAccessToken;
    delete (publicForm as Record<string, unknown>).metaCapiTestEventCode;

    // Per-form Origin allowlist gate (see doc comment above).
    const origin = req.headers.origin;
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'This domain is not allowed to embed this checkout form.' });
      return;
    }

    const paystackPublicKey = tenantId ? await paystackService.getPublicKey(tenantId) : '';

    res.json({ config: { ...publicForm, paystackPublicKey } });
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

    // Get form with product — the form's tenantId determines the tenant context
    // for this unauthenticated request
    const form = await prisma.checkoutForm.findFirst({
      where: {
        slug: slug,
        isActive: true
      },
      include: {
        product: true,
        // Load the authoritative package/upsell prices. Order totals are computed
        // from these, NEVER from the client-supplied amounts (price tampering).
        packages: true,
        upsells: true
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

    // Derive tenantId from the checkout form (public routes have no auth context)
    const formTenantId = (form as any).tenantId as string | null;

    const isDigital = form.product.productType === 'digital';

    // Resolve the payment method. Digital products always pay full via Paystack
    // (unchanged). Physical products honor the form's toggle matrix and the
    // buyer's choice; the server cross-checks the chosen method against the
    // form's enabled toggles, so a tampered request body can't pay through a
    // method the merchant disabled.
    const requestedMethod = req.body.paymentMethod as PaymentMethod | undefined;
    let paymentMethod: PaymentMethod;
    if (isDigital) {
      paymentMethod = 'paystack_full';
    } else {
      paymentMethod = requestedMethod ?? 'cod';
      const enabledFor: Record<PaymentMethod, boolean> = {
        cod: form.codEnabled,
        paystack_deposit: form.paystackDepositEnabled,
        paystack_full: form.paystackFullEnabled,
      };
      if (!enabledFor[paymentMethod]) {
        res.status(400).json({ error: 'Selected payment method is not available for this form' });
        return;
      }
    }
    const isPaystack = paymentMethod === 'paystack_deposit' || paymentMethod === 'paystack_full';

    // Validate required fields — digital products don't need address/state
    const requiredFields = isDigital
      ? ['name', 'phoneNumber']
      : ['name', 'phoneNumber', 'address', 'state'];
    for (const field of requiredFields) {
      if (!formData[field]) {
        res.status(400).json({ error: `Missing required field: ${field}` });
        return;
      }
    }

    // Paystack orders settle into the form's tenant Paystack account; without
    // a tenant we'd create an orphaned unpaid order. Fail fast before any DB write.
    if (isPaystack && !formTenantId) {
      res.status(400).json({
        error: 'This checkout form is not attached to a tenant; Paystack cannot be initialized.',
      });
      return;
    }

    if (isDigital && !formData.email) {
      res.status(400).json({ error: 'Email is required for digital products' });
      return;
    }

    // Check if customer exists or create new one (scoped to tenant)
    let customer = await prisma.customer.findFirst({
      where: { phoneNumber: formData.phoneNumber, ...(formTenantId ? { tenantId: formTenantId } : {}) }
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
          address: formData.address || '',
          state: formData.state || '',
          area: formData.state || '',
          landmark: formData.landmark || null,
          notes: formData.notes || null,
          ...(formTenantId ? { tenantId: formTenantId } : {})
        }
      });
    } else {
      const updateData: Prisma.CustomerUpdateInput = {};
      if (formData.email && !customer.email) updateData.email = formData.email;
      if (formData.alternatePhone && !customer.alternatePhone) updateData.alternatePhone = formData.alternatePhone;
      if (Object.keys(updateData).length > 0) {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: updateData,
        });
      }
    }

    // IP-based cooldown: block repeat orders from same IP on same form within 10 minutes
    {
      const cooldownFrom = new Date(Date.now() - 10 * 60 * 1000);
      const recentSubmission = await prisma.formSubmission.findFirst({
        where: {
          formId: form.id,
          ipAddress: req.ip,
          createdAt: { gte: cooldownFrom }
        },
        select: { orderId: true },
        orderBy: { createdAt: 'desc' }
      });

      if (recentSubmission?.orderId) {
        res.status(429).json({
          success: false,
          message: 'Please wait before placing another order'
        });
        return;
      }
    }

    // Dedup guard: prevent double-submits within 30 minutes (same phone + amount + form)
    {
      const dedupeFrom = new Date(Date.now() - 30 * 60 * 1000);
      const existingOrder = await prisma.order.findFirst({
        where: {
          source: 'checkout_form',
          totalAmount: totalAmount,
          deletedAt: null,
          createdAt: { gte: dedupeFrom },
          customer: { phoneNumber: formData.phoneNumber },
          orderItems: {
            some: { productId: form.productId, itemType: 'package' }
          }
        },
        select: { id: true, totalAmount: true, status: true }
      });

      if (existingOrder) {
        res.status(201).json({
          success: true,
          orderId: existingOrder.id,
          order: {
            id: existingOrder.id,
            totalAmount: existingOrder.totalAmount,
            status: existingOrder.status
          },
          message: 'Order created successfully',
          deduplicated: true
        });
        return;
      }
    }

    // SECURITY: prices are authoritative from the DB, never trusted from the client.
    // Resolve the selected package and upsells against the form's stored rows and
    // compute the total from those — otherwise a tampered request body could set
    // price:1 and buy full-price goods (and digital products auto-fulfil on payment).
    const dbPackages = (form as any).packages as Array<{
      id: number; name: string; price: number; quantity: number;
      originalPrice: number | null; discountType: string; discountValue: number;
    }>;
    const selectedDbPackage =
      dbPackages.find((p) => p.id === Number(selectedPackage?.id)) ||
      dbPackages.find((p) => p.name === selectedPackage?.name);
    if (!selectedDbPackage) {
      res.status(400).json({ error: 'Selected package is not available' });
      return;
    }

    // Package price is the total bundle price (what customer pays); quantity is
    // what they receive. unitPrice is the effective per-item price.
    const packageQuantity = selectedDbPackage.quantity || 1;
    const packagePrice = selectedDbPackage.price;
    const packageTotal = packagePrice; // NOT price * quantity
    const unitPrice = packagePrice / packageQuantity;

    // Resolve each selected upsell against the form's DB upsells (by id) and sum
    // their server-side prices.
    const dbUpsells = (form as any).upsells as Array<{
      id: number; name: string; description: string | null; price: number;
      productId: number | null; items: any; originalPrice: number | null;
      discountType: string; discountValue: number;
    }>;
    const resolvedUpsells: typeof dbUpsells = [];
    if (selectedUpsells && Array.isArray(selectedUpsells)) {
      for (const upsell of selectedUpsells) {
        const dbUpsell = dbUpsells.find((u) => u.id === Number(upsell?.id));
        if (!dbUpsell) {
          res.status(400).json({ error: 'Selected add-on is not available' });
          return;
        }
        resolvedUpsells.push(dbUpsell);
      }
    }
    const upsellsTotal = resolvedUpsells.reduce((sum, u) => sum + u.price, 0);

    const subtotal = packageTotal + upsellsTotal;
    const shippingCost = 0; // Can be calculated based on region
    const discount = 0;
    const finalTotal = subtotal + shippingCost - discount;

    // Payment amounts in minor units (pesewas/kobo) — Paystack charges in minor
    // units, and Order.depositPaid/balanceDue are stored the same way. For a
    // deposit, the buyer pays `depositPercent` of the total online now and the
    // remaining balance is collected on delivery (COD-style).
    const totalMinorUnits = Math.round(finalTotal * 100);
    let balanceDueMinor = 0;
    let paystackChargeMinor = totalMinorUnits;
    if (paymentMethod === 'paystack_deposit') {
      const pct = form.depositPercent ?? 0;
      paystackChargeMinor = Math.round((totalMinorUnits * pct) / 100);
      balanceDueMinor = totalMinorUnits - paystackChargeMinor;
    }

    // Prepare order items array: main package + upsells
    const orderItemsData = [];

    // 1. Add main package as order item (all values from the DB-resolved package)
    orderItemsData.push({
      productId: form.productId,
      quantity: packageQuantity,
      unitPrice: unitPrice,
      totalPrice: packageTotal,
      itemType: 'package',
      metadata: {
        packageName: selectedDbPackage.name,
        originalPrice: selectedDbPackage.originalPrice,
        discountType: selectedDbPackage.discountType,
        discountValue: selectedDbPackage.discountValue
      }
    });

    // 2. Add upsells as order items (from the DB-resolved upsells)
    for (const dbUpsell of resolvedUpsells) {
      // Use upsell's productId if available, otherwise fallback to form's productId
      const upsellProductId = dbUpsell.productId || form.productId;
      const upsellQuantity = dbUpsell.items?.quantity || 1;

      orderItemsData.push({
        productId: upsellProductId,
        quantity: upsellQuantity,
        unitPrice: dbUpsell.price / upsellQuantity,
        totalPrice: dbUpsell.price,
        itemType: 'upsell',
        metadata: {
          upsellName: dbUpsell.name,
          upsellDescription: dbUpsell.description,
          originalPrice: dbUpsell.originalPrice,
          discountType: dbUpsell.discountType,
          discountValue: dbUpsell.discountValue
        }
      });
    }

    // Create order with the checkout form's tenantId
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        status: isPaystack ? OrderStatus.payment_pending : OrderStatus.pending_confirmation,
        orderType: isDigital ? 'digital' : 'physical',
        // Digital keeps the generic 'paystack' label for back-compat; physical
        // stores the granular method so the verify path can tell deposit vs full.
        paymentMethod: isDigital ? 'paystack' : paymentMethod,
        subtotal,
        shippingCost,
        discount,
        totalAmount: finalTotal,
        // What the delivery agent collects: full for COD, otherwise the balance
        // due (the deposit's remainder, or 0 for a fully-prepaid order).
        codAmount: paymentMethod === 'cod' ? finalTotal : balanceDueMinor / 100,
        balanceDue: balanceDueMinor,
        deliveryAddress: formData.address || null,
        deliveryState: formData.state || null,
        deliveryArea: formData.state || null,
        notes: formData.notes || null,
        source: 'checkout_form',
        ...(formTenantId ? { tenantId: formTenantId } : {}),
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

    // Paystack methods (digital full, physical full, physical deposit): initialize
    // the transaction against the tenant's Paystack account and hand the buyer an
    // authorization URL. The amount is the deposit portion for a deposit order,
    // otherwise the full total.
    if (isPaystack) {
      // formTenantId guaranteed non-null here — guarded at the top before any DB write.
      // Carry orderId in the callback URL so PaymentCallback can resolve the tenant
      // even when its verify hits before the webhook (verifyPaymentCore fallback).
      const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/payment/callback?orderId=${order.id}`;
      const currency = form.currency || 'GHS';
      // Paystack requires an email; synthesize a stable one from the phone when
      // the buyer left it blank (physical Paystack orders don't require email).
      const buyerEmail =
        formData.email || `${String(formData.phoneNumber).replace(/\D/g, '')}@codadminpro.com`;

      const paystackResult = await paystackService.initializeTransaction(
        formTenantId as string,
        buyerEmail,
        paystackChargeMinor,
        currency,
        { orderId: order.id, formSlug: slug, paymentMethod },
        callbackUrl,
      );

      res.status(201).json({
        success: true,
        orderId: order.id,
        order: {
          id: order.id,
          totalAmount: order.totalAmount,
          status: order.status,
        },
        paymentMethod,
        amount: paystackChargeMinor,
        currency,
        authorization_url: paystackResult.authorization_url,
        paymentReference: paystackResult.reference,
        message: 'Order created — redirecting to payment',
      });
      return;
    }

    // COD orders are "purchased" at creation (payment settles on delivery), so
    // fire the server-side Meta Purchase event now. Best-effort + idempotent;
    // Paystack orders fire instead on settlement (see paystackController).
    metaCapiService.fireCapiPurchaseEvent(order.id).catch((err) => {
      console.error('Meta CAPI fire failed for COD order:', err);
    });

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
