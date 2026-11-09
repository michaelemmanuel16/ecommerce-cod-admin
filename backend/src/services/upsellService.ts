import prisma from '../utils/prisma';
import { getTenantId, resolveTenantId, runInTenant } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { UpsellKind, UpsellStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import logger from '../utils/logger';
import { createCommissionEntriesOnConfirm } from './commissionService';

export interface ApplyUpsellInput {
  orderId: number;
  repId: number;
  packageId?: number;
  addOnIds?: number[];
  openedAt?: Date | string;
  expectedStatusVersion?: number;
  tenantId?: string;
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

    // Sort submissions newest first
    const submissions = [...order.formSubmissions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    let form: any = submissions[0]?.form ?? null;
    if (!form && order.orderItems[0]?.productId) {
      form = await prisma.checkoutForm.findFirst({
        where: { productId: order.orderItems[0].productId, archivedAt: null },
        include: {
          packages: true,
          upsells: {
            where: { isActive: true },
            include: { product: true },
          },
          product: true,
        },
      });
    }

    // Determine current package from submission or order items
    let currentPackageId: number | null = null;
    let currentPackageName: string | null = null;
    let currentPackagePrice = Money.parse(order.subtotal);

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

    // Form packages: filter out archived packages
    // A package is archived if form.archivedAt is set, or if package is marked archived,
    // or if the underlying product is archived (!form.product.isActive).
    const packages = [...(form?.packages ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const isFormArchived = form?.archivedAt != null;
    const isProductArchived = form?.product ? !form.product.isActive : false;

    const availablePackages: UpsellOptionPackage[] = [];
    if (!isFormArchived && !isProductArchived) {
      for (const pkg of packages) {
        // Exclude archived packages (e.g. description includes [archived] or flag)
        const isPkgArchived = (pkg as any).archivedAt != null ||
          (pkg as any).isActive === false ||
          pkg.name.toLowerCase().includes('(archived)') ||
          pkg.description?.toLowerCase().includes('(archived)');

        if (isPkgArchived) {
          continue;
        }

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

    // Upsells/addons
    const availableAddons: UpsellOptionAddon[] = [];
    const upsells = [...(form?.upsells ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const addon of upsells) {
      if (!addon.isActive) continue;
      if (addon.product && !addon.product.isActive) continue;

      availableAddons.push({
        id: addon.id,
        name: addon.name,
        price: Money.parse(addon.price).toFixed(4),
        productId: addon.productId,
        isActive: addon.isActive,
      });
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
      return runInTenant(tid, () => this.doApplyUpsell(input, tid));
    }
    return this.doApplyUpsell(input);
  }

  private async doApplyUpsell(input: ApplyUpsellInput, tid?: string): Promise<ApplyUpsellResult> {
    const { orderId, repId, packageId, addOnIds, openedAt, expectedStatusVersion } = input;

    // Load order
    const order = await prisma.order.findUnique({
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

    const tenantId = resolveTenantId(tid ?? input.tenantId ?? order.tenantId);

    // Concurrency detection:
    // If openedAt is provided, and order was updated after openedAt or other upsell lines exist created after openedAt
    let warningFlag = false;
    let warning: string | undefined;

    if (openedAt) {
      const openedTime = new Date(openedAt).getTime();
      const lastOrderUpdateTime = new Date(order.updatedAt).getTime();
      // Allow 1 second clock leeway
      if (lastOrderUpdateTime > openedTime + 1000) {
        warningFlag = true;
        warning = 'Order was modified concurrently by another user; your changes were saved.';
      }
    } else if (expectedStatusVersion !== undefined && order.statusVersion !== expectedStatusVersion) {
      warningFlag = true;
      warning = 'Order status changed concurrently; your changes were saved.';
    }

    // Sort submissions newest first
    const submissions = [...order.formSubmissions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Determine baseline order amounts (before any active upsell lines were applied)
    const currentActiveUpsells = order.upsellLines.filter((l) => l.status === 'active');
    const existingActiveExtraValue = Money.sum(currentActiveUpsells.map((l) => l.extraValue));

    // Baseline amounts before any active upsells
    const baselineSubtotal = Money.sub(order.subtotal, existingActiveExtraValue);
    const baselineTotalAmount = Money.sub(order.totalAmount, existingActiveExtraValue);
    const baselineCodAmount = order.codAmount
      ? Money.sub(order.codAmount, existingActiveExtraValue)
      : baselineTotalAmount;

    // Determine baseline package price
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

    // Server calculates extra value:
    // 1. Package extra value
    let packageExtraValue = new Decimal(0);
    let selectedPackageRecord: any = null;
    if (packageId != null) {
      selectedPackageRecord = await prisma.formPackage.findUnique({
        where: { id: packageId },
        include: { form: { include: { product: true } } },
      });

      if (!selectedPackageRecord) {
        throw new AppError('Selected package not found', 404);
      }

      // Check if package is archived
      const isPkgArchived = (selectedPackageRecord as any).archivedAt != null ||
        (selectedPackageRecord as any).isActive === false ||
        selectedPackageRecord.form?.archivedAt != null ||
        (selectedPackageRecord.form?.product && !selectedPackageRecord.form.product.isActive) ||
        selectedPackageRecord.name.toLowerCase().includes('(archived)') ||
        selectedPackageRecord.description?.toLowerCase().includes('(archived)');

      if (isPkgArchived) {
        throw new AppError('Selected package is archived and no longer offered', 400);
      }

      const pkgPrice = Money.parse(selectedPackageRecord.price);
      if (pkgPrice.gt(baselinePackagePrice)) {
        packageExtraValue = Money.sub(pkgPrice, baselinePackagePrice);
      }
    }

    // 2. Add-ons extra value
    const validAddons: { id: number; price: Decimal }[] = [];
    if (addOnIds && addOnIds.length > 0) {
      for (const addonId of addOnIds) {
        const addon = await prisma.formUpsell.findUnique({
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
        });
      }
    }

    const addonsExtraValue = Money.sum(validAddons.map((a) => a.price));
    const totalExtraValue = Money.add(packageExtraValue, addonsExtraValue);
    const estimatedReward = Money.roundHalfUp(Money.mul(totalExtraValue, 0.10), 2);

    // Apply in transaction (Last save wins)
    const result = await prisma.$transaction(async (tx) => {
      // 1. Void any previous active upsell lines for this order (last save wins)
      if (currentActiveUpsells.length > 0) {
        await tx.upsellLine.updateMany({
          where: { orderId, status: 'active' },
          data: { status: 'void' },
        });
      }

      // 2. Create new active upsell lines
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

      // 3. Update order totals
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

      // 4. If order is already confirmed, sync pending commission entries
      if (order.status === 'confirmed') {
        await createCommissionEntriesOnConfirm(tx, orderId, repId);
      }

      return {
        createdLines,
        updatedOrder,
      };
    });

    logger.info('Applied upsell to order', {
      orderId,
      repId,
      totalExtraValue: totalExtraValue.toFixed(4),
      linesCount: result.createdLines.length,
      warningFlag,
    });

    return {
      orderId,
      repId,
      extraValue: totalExtraValue.toFixed(4),
      estimatedReward: estimatedReward.toFixed(2),
      lines: result.createdLines.map((l) => ({
        id: l.id,
        kind: l.kind,
        sourceId: l.sourceId,
        extraValue: Money.parse(l.extraValue).toFixed(4),
        status: l.status,
      })),
      warningFlag,
      warning,
      order: {
        id: result.updatedOrder.id,
        subtotal: Money.parse(result.updatedOrder.subtotal).toFixed(4),
        totalAmount: Money.parse(result.updatedOrder.totalAmount).toFixed(4),
        codAmount: Money.parse(result.updatedOrder.codAmount ?? result.updatedOrder.totalAmount).toFixed(4),
      },
    };
  }
}

export const upsellService = new UpsellService();
export default upsellService;
