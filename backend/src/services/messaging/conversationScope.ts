import { Prisma } from '@prisma/client';

/**
 * The conversations a call rep may open, read, answer and mark: (A) the customer has an order whose
 * `customerRepId` is the rep, plus (B) the conversation is assigned to the rep. Nothing else.
 * Shared by the conversation API and the rep Inbox, so a row in the Inbox always opens.
 */
export const repConversationWhere = (repId: number): Prisma.ConversationWhereInput => ({
  OR: [
    { assignedToId: repId },
    { customer: { orders: { some: { customerRepId: repId, deletedAt: null } } } },
  ],
});
