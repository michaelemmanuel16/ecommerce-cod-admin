import { usePermissions } from './usePermissions';

/** What the Finance screens may do. A screen shows a disabled button with a tooltip when a flag is false. */
export const useFinancePermissions = () => {
  const { can } = usePermissions();
  return {
    canAddExpense: can('financial', 'create'),
    canEditExpense: can('expenses', 'edit'),
    canDeleteExpense: can('expenses', 'delete'),
    canPostJournal: can('journal', 'post'),
    canVoidJournal: can('journal', 'void'),
  };
};

export const NO_PERMISSION = {
  addExpense: 'You do not have permission to add expenses.',
  editExpense: 'You do not have permission to edit expenses.',
  deleteExpense: 'You do not have permission to delete expenses.',
  postJournal: 'Only the owner and the finance clerk can post a journal entry.',
  voidJournal: 'Only the owner and the finance clerk can void a journal entry.',
} as const;
