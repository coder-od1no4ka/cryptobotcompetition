import { Router } from 'express';
import UserController from '../controllers/UserController';
import { param, body } from 'express-validator';
import { validateRequest } from '../middleware/errorHandler';

const router = Router();

router.get('/:userId', param('userId').notEmpty(), validateRequest, UserController.getUser);
router.post('/:userId', param('userId').notEmpty(), validateRequest, UserController.getOrCreateUser);
router.get('/:userId/balance', param('userId').notEmpty(), validateRequest, UserController.getBalance);
router.post('/:userId/deposit',
  param('userId').notEmpty(),
  body('amount').isFloat({ min: 0 }).withMessage('amount must be a non-negative number'),
  validateRequest,
  UserController.deposit
);
router.get('/:userId/transactions',
  param('userId').notEmpty(),
  validateRequest,
  UserController.getTransactionHistory
);

export default router;

