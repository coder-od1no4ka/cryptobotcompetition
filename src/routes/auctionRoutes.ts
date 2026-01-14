import { Router } from 'express';
import AuctionController from '../controllers/AuctionController';
import { body, param } from 'express-validator';
import { validateRequest } from '../middleware/errorHandler';

const router = Router();

// Валидация для создания аукциона
const createAuctionValidation = [
  body('title').notEmpty().withMessage('Title is required'),
  body('totalItems').isInt({ min: 1 }).withMessage('totalItems must be a positive integer'),
  body('itemsPerRound').isInt({ min: 1 }).withMessage('itemsPerRound must be a positive integer'),
  body('roundDuration').isInt({ min: 10 }).withMessage('roundDuration must be at least 10 seconds'),
  body('minBid').isFloat({ min: 0 }).withMessage('minBid must be a non-negative number'),
];

// Валидация для ставки
const placeBidValidation = [
  body('userId').notEmpty().withMessage('userId is required'),
  body('amount').isFloat({ min: 0 }).withMessage('amount must be a non-negative number'),
];

router.post('/', createAuctionValidation, validateRequest, AuctionController.createAuction);
router.get('/', AuctionController.getAllAuctions);
router.get('/active', AuctionController.getActiveAuctions);
router.get('/:id', param('id').notEmpty(), validateRequest, AuctionController.getAuction);
router.post('/:id/start', param('id').notEmpty(), validateRequest, AuctionController.startAuction);
router.post('/:id/bid', param('id').notEmpty(), placeBidValidation, validateRequest, AuctionController.placeBid);
router.post('/:id/complete-round', param('id').notEmpty(), validateRequest, AuctionController.completeRound);
router.get('/:id/round/:roundNumber/leaderboard', 
  param('id').notEmpty(),
  param('roundNumber').isInt(),
  validateRequest,
  AuctionController.getRoundLeaderboard
);
router.get('/:id/user/:userId/bids',
  param('id').notEmpty(),
  param('userId').notEmpty(),
  validateRequest,
  AuctionController.getUserBids
);
router.post('/fix-problematic', AuctionController.fixProblematicAuctions);

export default router;

