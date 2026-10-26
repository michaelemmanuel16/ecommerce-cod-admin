import { Router } from 'express';
import * as glController from '../controllers/glController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import {
  paginationValidation,
  createAccountValidation,
  updateAccountValidation,
  createJournalEntryValidation,
  voidJournalEntryValidation
} from '../utils/validators';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// Chart of Accounts
router.get('/accounts', requireResourcePermission('gl', 'view'), paginationValidation, validate, glController.getAllAccounts);
router.post('/accounts', requireResourcePermission('gl', 'create'), createAccountValidation, validate, glController.createAccount);
router.get('/accounts/:id', requireResourcePermission('gl', 'view'), glController.getAccount);
router.put('/accounts/:id', requireResourcePermission('gl', 'update'), updateAccountValidation, validate, glController.updateAccount);
router.delete('/accounts/:id', requireResourcePermission('gl', 'delete'), glController.deleteAccount);
router.patch('/accounts/:id/deactivate', requireResourcePermission('gl', 'update'), glController.deactivateAccount);
router.patch('/accounts/:id/activate', requireResourcePermission('gl', 'update'), glController.activateAccount);

// Trial balance line under the chart: total debits equal total credits
router.get('/trial-balance', requireResourcePermission('gl', 'view'), glController.getTrialBalance);

// Account Balance & Ledger
router.get('/accounts/:id/balance', requireResourcePermission('gl', 'view'), glController.getAccountBalance);
router.get('/accounts/:id/ledger', requireResourcePermission('gl', 'view'), paginationValidation, validate, glController.getAccountLedger);
router.get('/accounts/:id/ledger/export', requireResourcePermission('gl', 'view'), glController.exportAccountLedger);

// Journal Entries. Posting and voiding by hand: owner and finance clerk (F-920).
router.post('/journal-entries', requireResourcePermission('journal', 'post'), createJournalEntryValidation, validate, glController.createJournalEntry);
router.get('/journal-entries', requireResourcePermission('gl', 'view'), paginationValidation, validate, glController.getJournalEntries);
router.get('/journal-entries/:id', requireResourcePermission('gl', 'view'), glController.getJournalEntry);
router.post('/journal-entries/:id/void', requireResourcePermission('journal', 'void'), voidJournalEntryValidation, validate, glController.voidJournalEntry);

export default router;
