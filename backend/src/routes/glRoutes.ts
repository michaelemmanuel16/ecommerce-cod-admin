import { Router } from 'express';
import * as glController from '../controllers/glController';
import { authenticate, requireResourcePermission, requireSuperAdmin } from '../middleware/auth';
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

// Chart of Accounts
router.get('/accounts', requireResourcePermission('gl', 'view'), paginationValidation, validate, glController.getAllAccounts);
router.post('/accounts', requireResourcePermission('gl', 'create'), createAccountValidation, validate, glController.createAccount);
router.get('/accounts/:id', requireResourcePermission('gl', 'view'), glController.getAccount);
router.put('/accounts/:id', requireResourcePermission('gl', 'update'), updateAccountValidation, validate, glController.updateAccount);
router.delete('/accounts/:id', requireResourcePermission('gl', 'delete'), glController.deleteAccount);
router.patch('/accounts/:id/deactivate', requireResourcePermission('gl', 'update'), glController.deactivateAccount);
router.patch('/accounts/:id/activate', requireResourcePermission('gl', 'update'), glController.activateAccount);

// Account Balance & Ledger
router.get('/accounts/:id/balance', requireResourcePermission('gl', 'view'), glController.getAccountBalance);
router.get('/accounts/:id/ledger', requireResourcePermission('gl', 'view'), paginationValidation, validate, glController.getAccountLedger);

// Journal Entries
router.post('/journal-entries', requireSuperAdmin, createJournalEntryValidation, validate, glController.createJournalEntry);
router.get('/journal-entries', requireResourcePermission('gl', 'view'), paginationValidation, validate, glController.getJournalEntries);
router.get('/journal-entries/:id', requireResourcePermission('gl', 'view'), glController.getJournalEntry);
router.post('/journal-entries/:id/void', requireSuperAdmin, voidJournalEntryValidation, validate, glController.voidJournalEntry);

export default router;
