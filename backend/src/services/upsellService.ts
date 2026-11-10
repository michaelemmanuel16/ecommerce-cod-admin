import prisma, { TransactionClient } from '../utils/prisma';
import { getTenantId, resolveTenantId, runInTenant } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { Prisma, UpsellKind, UpsellStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import logger from '../utils/logger';
import { UPSELL_COMMISSION_RATE } from './commissionService';

export interface ApplyUpsellInput {
  orderId: number;
  repId: number;
  role?: string;
  packageId?: number;
  addOnIds?: number[];
  openedAt?: Date | string;
  expectedStatusVersion?: number;
  tenantId?: string;
  tx?: TransactionClient;
  // Any client-provided value/extraValue fields must be ignored
  value?: any;
  extraValue?: any;
}

export interface UpsellOptionPackage {
  id: number;
  name: string;
  price: string;
  quantity: number;
  isPopular: boolean;
  isDefault: boolean;
  extraValueFromBase: string;
}

export interface UpsellOptionAddon {
  id: number;
  name: string;
  price: string;
  productId: number | null;
  isActive: boolean;
}

export interface UpsellOptionsResult {
  orderId: number;
  currentPackage: {
    id: number | null;
    name: string | null;
    price: string;
  };
  availablePackages: UpsellOptionPackage[];
  availableAddons: UpsellOptionAddon[];
}

export interface ApplyUpsellResult {
  orderId: number;
  repId: number;
  extraValue: string;
  estimatedReward: string;
  lines: {
    id: number;
    kind: UpsellKind;
    sourceId: number | null;
    extraValue: string;
    status: UpsellStatus;
  }[];
  warningFlag: boolean;
  warning?: string;
  order: {
    id: number;
    subtotal: string;
    totalAmount: string;
    codAmount: string;
  };
}

export class UpsellService {
  async getUpsellOptions(orderId: number, tenantId?: string): Promise<UpsellOptionsResult> {
    const tid = tenantId ?? getTenantId();
    if (tid) {
      return runInTenant(tid, () => this.doGetUpsellOptions(orderId));
    }
    return this.doGetUpsellOptions(orderId);
  }

  private async doGetUpsellOptions(orderId: number): Promise<UpsellOptionsResult> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        formSubmissions: {
          include: {
            form: {
              include: {
                packages: true,
                upsells: {
                  where: { isActive: true },
                  include: { product: true },
                },
                product: true,
              },
            },
          },
        },
        orderItems: {
          include: { product: true },
        },
      },
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Determine current package from submission or order items
    let currentPackageId: number | null = null;
    let currentPackageName: string | null = null;
    let currentPackagePrice = Money.parse(order.subtotal);

    const submissions = [...order.formSubmissions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const submission = submissions[0];
    if (submission?.selectedPackage) {
      try {
        const pkg = typeof submission.selectedPackage === 'string'
          ? JSON.parse(submission.selectedPackage)
          : submission.selectedPackage;
        currentPackageId = pkg.id ?? pkg.packageId ?? null;
        currentPackageName = pkg.name ?? null;
        if (pkg.price != null) {
          currentPackagePrice = Money.parse(pkg.price);
        }
      } catch (e) {
        logger.warn('Failed to parse submission selectedPackage', { error: e });
      }
    }

    // No checkout submission (e.g. a manual order): the package is the order's package line.
    if (currentPackageName == null) {
      const line = order.orderItems.find((i) => i.itemType === 'package');
      if (line) {
        const meta = (line.metadata ?? {}) as { packageName?: string; packageId?: number };
        currentPackageId = currentPackageId ?? meta.packageId ?? null;
        currentPackageName = meta.packageName ?? `${line.quantity} × ${line.product?.name ?? 'Product'}`;
        currentPackagePrice = Money.parse(line.totalPrice);
      }
    }

    // Collect productIds for this order
    const productIds: number[] = [];
    for (const item of order.orderItems) {
      if (item.productId && !productIds.includes(item.productId)) {
        productIds.push(item.productId);
      }
    }
    for (const sub of order.formSubmissions) {
      if (sub.form?.productId && !productIds.includes(sub.form.productId)) {
        productIds.push(sub.form.productId);
      }
    }

    // Load active forms for these products
    const forms = await prisma.checkoutForm.findMany({
      where: {
        productId: { in: productIds },
        archivedAt: null,
      },
      include: {
        packages: true,
        upsells: {
          where: { isActive: true },
          include: { product: true },
        },
        product: true,
      },
    });

    const subForm = submissions[0]?.form;
    if (subForm && subForm.archivedAt == null && !forms.some((f) => f.id === subForm.id)) {
      forms.push(subForm as any);
    }

    // Packages: A package is not offered when its form has archivedAt set or its product is not active.
    const availablePackages: UpsellOptionPackage[] = [];
    const seenPkgIds = new Set<number>();
    for (const f of forms) {
      if (f.archivedAt != null) continue;
      if (f.product && !f.product.isActive) continue;

      const packages = [...(f.packages ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      for (const pkg of packages) {
        if (seenPkgIds.has(pkg.id)) continue;
        seenPkgIds.add(pkg.id);

        const pkgPrice = Money.parse(pkg.price);
        const diff = Money.sub(pkgPrice, currentPackagePrice);
        const extraFromBase = Money.gt(diff, 0) ? diff : Money.parse(0);

        availablePackages.push({
          id: pkg.id,
          name: pkg.name,
          price: pkgPrice.toFixed(4),
          quantity: pkg.quantity,
          isPopular: pkg.isPopular,
          isDefault: pkg.isDefault,
          extraValueFromBase: extraFromBase.toFixed(4),
        });
      }
    }

    // A form edit re-creates its packages with new ids, so an older order can point to an id that
    // no longer exists. Match the current package to the live package with the same name.
    if (currentPackageName != null && !availablePackages.some((p) => p.id === currentPackageId)) {
      const wanted = currentPackageName.trim().toLowerCase();
      const live = availablePackages.find((p) => p.name.trim().toLowerCase() === wanted);
      if (live) currentPackageId = live.id;
    }

    // Addons
    const availableAddons: UpsellOptionAddon[] = [];
    const seenAddonIds = new Set<number>();
    for (const f of forms) {
      if (f.archivedAt != null) continue;
      if (f.product && !f.product.isActive) continue;

      const upsells = [...(f.upsells ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      for (const addon of upsells) {
        if (!addon.isActive || (addon.product && !addon.product.isActive)) continue;
        if (seenAddonIds.has(addon.id)) continue;
        seenAddonIds.add(addon.id);

        availableAddons.push({
          id: addon.id,
          name: addon.name,
          price: Money.parse(addon.price).toFixed(4),
          productId: addon.productId,
          isActive: addon.isActive,
        });
      }
    }

    return {
      orderId,
      currentPackage: {
        id: currentPackageId,
        name: currentPackageName,
        price: currentPackagePrice.toFixed(4),
      },
      availablePackages,
      availableAddons,
    };
  }

  async applyUpsell(input: ApplyUpsellInput): Promise<ApplyUpsellResult> {
    const tid = input.tenantId ?? getTenantId();
    if (tid) {
      return runInTenant(tid, () => this.executeApplyUpsell(input, tid));
    }
    return this.executeApplyUpsell(input);
  }

  private async executeApplyUpsell(input: ApplyUpsellInput, tid?: string): Promise<ApplyUpsellResult> {
    if (input.tx) {
      return this.doApplyUpsell(input.tx, input, tid);
    }
    return prisma.$transaction((tx) => this.doApplyUpsell(tx, input, tid));
  }

  private async doApplyUpsell(tx: TransactionClient, input: ApplyUpsellInput, tid?: string): Promise<ApplyUpsellResult> {
    const { orderId, repId, role, packageId, addOnIds, openedAt, expectedStatusVersion } = input;
    const resolvedTid = resolveTenantId(tid ?? input.tenantId);

    // Concurrency / Row lock: take lock inside transaction
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND tenant_id = ${resolvedTid} FOR UPDATE`;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        formSubmissions: {
          include: {
            form: {
              include: {
                packages: true,
                upsells: true,
                product: true,
              },
            },
          },
        },
        orderItems: true,
        upsellLines: true,
      },
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // F5 item 1: sales_rep ownership check
    if (role === 'sales_rep') {
      if (order.customerRepId != null && order.customerRepId !== repId) {
        throw new AppError("You cannot upsell another rep's order", 403, 'FORBIDDEN');
      }
    }

    // F5 item 2: only pending_confirmation or confirmed orders
    if (order.status !== 'pending_confirmation' && order.status !== 'confirmed') {
      throw new AppError('Upsell is only allowed on pending confirmation or confirmed orders', 409, 'INVALID_ORDER_STATUS');
    }

    const tenantId = resolveTenantId(tid ?? input.tenantId ?? order.tenantId);

    // Concurrency detection
    let warningFlag = false;
    let warning: string | undefined;

    if (openedAt) {
      const openedTime = new Date(openedAt).getTime();
      const lastOrderUpdateTime = new Date(order.updatedAt).getTime();
      if (lastOrderUpdateTime > openedTime + 1000) {
        warningFlag = true;
        warning = 'Order was modified concurrently by another user; your changes were saved.';
      }
    } else if (expectedStatusVersion !== undefined && order.statusVersion !== expectedStatusVersion) {
      warningFlag = true;
      warning = 'Order status changed concurrently; your changes were saved.';
    }

    const submissions = [...order.formSubmissions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const currentActiveUpsells = order.upsellLines.filter((l) => l.status === 'active');
    const existingActiveExtraValue = Money.sum(currentActiveUpsells.map((l) => l.extraValue));

    const baselineSubtotal = Money.sub(order.subtotal, existingActiveExtraValue);
    const baselineTotalAmount = Money.sub(order.totalAmount, existingActiveExtraValue);
    const baselineCodAmount = order.codAmount
      ? Money.sub(order.codAmount, existingActiveExtraValue)
      : baselineTotalAmount;

    let baselinePackagePrice = baselineSubtotal;
    const submission = submissions[0];
    if (submission?.selectedPackage) {
      try {
        const pkg = typeof submission.selectedPackage === 'string'
          ? JSON.parse(submission.selectedPackage)
          : submission.selectedPackage;
        if (pkg.price != null) {
          baselinePackagePrice = Money.parse(pkg.price);
        }
      } catch (e) {
        logger.warn('Failed to parse submission selectedPackage', { error: e });
      }
    }

    // F5 item 4: Package validation
    let packageExtraValue = new Decimal(0);
    let selectedPackageRecord: any = null;
    if (packageId != null) {
      selectedPackageRecord = await tx.formPackage.findUnique({
        where: { id: packageId },
        include: { form: { include: { product: true } } },
      });

      if (!selectedPackageRecord) {
        throw new AppError('Selected package not found', 404);
      }

      const isFormArchived = selectedPackageRecord.form?.archivedAt != null;
      const isProductActive = selectedPackageRecord.form?.product ? selectedPackageRecord.form.product.isActive : true;

      if (isFormArchived || !isProductActive) {
        throw new AppError('Selected package is archived and no longer offered', 400);
      }

      const pkgPrice = Money.parse(selectedPackageRecord.price);
      if (pkgPrice.lt(baselinePackagePrice)) {
        // An upsell only adds value. Lowering an order is an order edit, not an upsell.
        throw new AppError('A smaller package lowers the order. Edit the order to do that.', 400, 'PACKAGE_DOWNGRADE');
      }
      if (pkgPrice.gt(baselinePackagePrice)) {
        packageExtraValue = Money.sub(pkgPrice, baselinePackagePrice);
      }
    }

    // Addons validation
    const validAddons: { id: number; price: Decimal; name: string; productId: number | null; items: Prisma.JsonValue }[] = [];
    if (addOnIds && addOnIds.length > 0) {
      for (const addonId of addOnIds) {
        const addon = await tx.formUpsell.findUnique({
          where: { id: addonId },
          include: { product: true },
        });

        if (!addon) {
          throw new AppError(`Add-on ${addonId} not found`, 404);
        }
        if (!addon.isActive || (addon.product && !addon.product.isActive)) {
          throw new AppError(`Add-on ${addon.name} is archived or no longer offered`, 400);
        }

        validAddons.push({
          id: addon.id,
          price: Money.parse(addon.price),
          name: addon.name,
          productId: addon.productId,
          items: addon.items ?? null,
        });
      }
    }

    // F5 item 5: UPSELL_COMMISSION_RATE
    const addonsExtraValue = Money.sum(validAddons.map((a) => a.price));
    const totalExtraValue = Money.add(packageExtraValue, addonsExtraValue);
    const estimatedReward = Money.roundHalfUp(Money.mul(totalExtraValue, UPSELL_COMMISSION_RATE), 2);

    // Void previous active upsell lines (last save wins)
    if (currentActiveUpsells.length > 0) {
      await tx.upsellLine.updateMany({
        where: { orderId, status: 'active' },
        data: { status: 'void' },
      });
    }

    // Create new active upsell lines
    const createdLines: any[] = [];
    if (packageId != null && packageExtraValue.gt(0)) {
      const pkgLine = await tx.upsellLine.create({
        data: {
          tenantId,
          orderId,
          repId,
          kind: 'package',
          sourceId: packageId,
          extraValue: packageExtraValue,
          status: 'active',
        },
      });
      createdLines.push(pkgLine);
    }

    for (const addon of validAddons) {
      const addonLine = await tx.upsellLine.create({
        data: {
          tenantId,
          orderId,
          repId,
          kind: 'addon',
          sourceId: addon.id,
          extraValue: addon.price,
          status: 'active',
        },
      });
      createdLines.push(addonLine);
    }

    await this.syncOrderLines(tx, orderId, packageExtraValue.gt(0) ? selectedPackageRecord : null, validAddons);

    // Update order totals
    const newSubtotal = Money.add(baselineSubtotal, totalExtraValue);
    const newTotalAmount = Money.add(baselineTotalAmount, totalExtraValue);
    const newCodAmount = Money.add(baselineCodAmount, totalExtraValue);

    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal: newSubtotal,
        totalAmount: newTotalAmount,
        codAmount: newCodAmount,
      },
    });

    // F5 item 6: On already confirmed order, only update the upsell entry of the rep who owns the live base entry
    if (order.status === 'confirmed') {
      const liveBaseEntry = await tx.commissionEntry.findFirst({
        where: { orderId, kind: 'base', status: { not: 'void' } },
      });
      if (liveBaseEntry) {
        const liveUpsellEntry = await tx.commissionEntry.findFirst({
          where: { orderId, kind: 'upsell', status: { not: 'void' } },
        });
        if (totalExtraValue.gt(0)) {
          const upsellAmount = Money.roundHalfUp(Money.mul(totalExtraValue, UPSELL_COMMISSION_RATE), 2);
          if (upsellAmount.gt(0)) {
            if (liveUpsellEntry) {
              if (liveUpsellEntry.status === 'pending' && !Money.parse(liveUpsellEntry.amount).equals(upsellAmount)) {
                await tx.commissionEntry.update({
                  where: { id: liveUpsellEntry.id },
                  data: { amount: upsellAmount, userId: liveBaseEntry.userId },
                });
              }
            } else {
              await tx.commissionEntry.create({
                data: {
                  tenantId,
                  orderId,
                  userId: liveBaseEntry.userId,
                  kind: 'upsell',
                  status: 'pending',
                  amount: upsellAmount,
                  note: 'Upsell commission on order update',
                },
              });
            }
          }
        } else if (liveUpsellEntry && liveUpsellEntry.status === 'pending') {
          await tx.commissionEntry.update({
            where: { id: liveUpsellEntry.id },
            data: { status: 'void' },
          });
        }
      }
    }

    logger.info('Applied upsell to order', {
      orderId,
      repId,
      totalExtraValue: totalExtraValue.toFixed(4),
      linesCount: createdLines.length,
      warningFlag,
    });

    return {
      orderId,
      repId,
      extraValue: totalExtraValue.toFixed(4),
      estimatedReward: estimatedReward.toFixed(2),
      lines: createdLines.map((l) => ({
        id: l.id,
        kind: l.kind,
        sourceId: l.sourceId,
        extraValue: Money.parse(l.extraValue).toFixed(4),
        status: l.status,
      })),
      warningFlag,
      warning,
      order: {
        id: updatedOrder.id,
        subtotal: Money.parse(updatedOrder.subtotal).toFixed(4),
        totalAmount: Money.parse(updatedOrder.totalAmount).toFixed(4),
        codAmount: Money.parse(updatedOrder.codAmount ?? updatedOrder.totalAmount).toFixed(4),
      },
    };
  }

  /**
   * Keep the order lines in step with the new totals, so the warehouse packs what the courier collects for.
   * The chosen package rewrites the package line; each add-on becomes its own line. A new save first puts back
   * what the last rep save changed (last save wins). Stock reserves from these lines (stockService RESERVING).
   */
  private async syncOrderLines(
    tx: TransactionClient,
    orderId: number,
    pkg: { id: number; name: string; price: Prisma.Decimal; quantity: number; discountType: string; discountValue: Prisma.Decimal; originalPrice: Prisma.Decimal | null; form?: { productId: number } | null } | null,
    addons: { id: number; price: Decimal; name: string; productId: number | null; items: Prisma.JsonValue }[],
  ): Promise<void> {
    const before = await tx.orderItem.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
    for (const item of before) {
      const meta = (item.metadata ?? {}) as Record<string, any>;
      if (meta.repUpsellAddon) {
        await tx.orderItem.delete({ where: { id: item.id } });
      } else if (meta.repUpsellOriginal) {
        const o = meta.repUpsellOriginal;
        await tx.orderItem.update({
          where: { id: item.id },
          data: { productId: o.productId, quantity: o.quantity, unitPrice: o.unitPrice, totalPrice: o.totalPrice, metadata: o.metadata ?? Prisma.JsonNull },
        });
      }
    }
    if (!pkg && addons.length === 0) return;

    const lines = await tx.orderItem.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
    const productId = pkg?.form?.productId ?? lines.find((l) => l.itemType === 'package')?.productId ?? lines[0]?.productId;
    if (productId == null) return;

    if (pkg) {
      const price = Money.parse(pkg.price);
      const data = {
        productId,
        quantity: pkg.quantity,
        unitPrice: Money.roundHalfUp(price.div(pkg.quantity), 4),
        totalPrice: price,
      };
      const pkgMeta = {
        packageName: pkg.name,
        packageId: pkg.id,
        discountType: pkg.discountType,
        discountValue: Money.parse(pkg.discountValue).toNumber(),
        originalPrice: pkg.originalPrice != null ? Money.parse(pkg.originalPrice).toNumber() : null,
      };
      const line = lines.find((l) => l.itemType === 'package') ?? lines.find((l) => l.productId === productId);
      if (line) {
        const repUpsellOriginal = {
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice.toString(),
          totalPrice: line.totalPrice.toString(),
          metadata: line.metadata,
        };
        await tx.orderItem.update({ where: { id: line.id }, data: { ...data, metadata: { ...pkgMeta, repUpsellOriginal } } });
      } else {
        await tx.orderItem.create({ data: { orderId, ...data, itemType: 'package', metadata: { ...pkgMeta, repUpsellAddon: true } } });
      }
    }

    for (const a of addons) {
      await tx.orderItem.create({
        data: {
          orderId,
          productId: a.productId ?? productId,
          quantity: 1,
          unitPrice: a.price,
          totalPrice: a.price,
          itemType: 'upsell',
          metadata: { upsellName: a.name, upsellId: a.id, items: a.items ?? null, repUpsellAddon: true } as Prisma.InputJsonValue,
        },
      });
    }
  }
}

export const upsellService = new UpsellService();
export default upsellService;
