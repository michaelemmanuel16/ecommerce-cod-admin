import { CollectionStatus } from '@prisma/client';
import * as Money from './money';

/** Collections a partner still holds the cash for: a deposit can cover them. `deposited` and `reconciled` are covered already. */
export const OPEN_COLLECTION_STATUSES: readonly CollectionStatus[] = ['draft', 'verified', 'approved'];

/** What is left of a collection that no deposit has covered yet. */
export const outstandingOf = (c: { amount: Money.MoneyInput; allocatedAmount?: Money.MoneyInput | null }): Money.Money =>
  Money.sub(c.amount, Money.orZero(c.allocatedAmount));
