import { Request, Response } from 'express';
import mongoose from 'mongoose';
import AuctionService from '../services/AuctionService';
import logger from '../config/logger';

export class AuctionController {
  async createAuction(req: Request, res: Response): Promise<void> {
    try {
      const auction = await AuctionService.createAuction(req.body);
      res.status(201).json(auction);
    } catch (error: any) {
      logger.error('Error creating auction:', error);
      res.status(400).json({ error: error.message });
    }
  }

  async startAuction(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // Валидация ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid auction ID format' });
        return;
      }
      
      const auction = await AuctionService.startAuction(id);
      res.json(auction);
    } catch (error: any) {
      logger.error('Error starting auction:', error);
      res.status(400).json({ error: error.message });
    }
  }

  async getAuction(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // Валидация ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid auction ID format' });
        return;
      }
      
      const auction = await AuctionService.getAuctionById(id);
      
      if (!auction) {
        res.status(404).json({ error: 'Auction not found' });
        return;
      }
      
      res.json(auction);
    } catch (error: any) {
      logger.error('Error getting auction:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getActiveAuctions(_req: Request, res: Response): Promise<void> {
    try {
      const auctions = await AuctionService.getActiveAuctions();
      res.json(auctions);
    } catch (error: any) {
      logger.error('Error getting active auctions:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getAllAuctions(_req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(_req.query.limit as string) || 50;
      const auctions = await AuctionService.getAllAuctions(limit);
      res.json(auctions);
    } catch (error: any) {
      logger.error('Error getting all auctions:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async placeBid(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // Валидация ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid auction ID format' });
        return;
      }
      
      const { userId, amount } = req.body;
      
      if (!userId || !amount) {
        res.status(400).json({ error: 'userId and amount are required' });
        return;
      }

      const bid = await AuctionService.placeBid(id, userId, amount);
      res.json(bid);
    } catch (error: any) {
      logger.error('Error placing bid:', error);
      res.status(400).json({ error: error.message });
    }
  }

  async completeRound(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // Валидация ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid auction ID format' });
        return;
      }
      
      const auction = await AuctionService.completeRound(id);
      res.json(auction);
    } catch (error: any) {
      logger.error('Error completing round:', error);
      res.status(400).json({ error: error.message });
    }
  }

  async getRoundLeaderboard(req: Request, res: Response): Promise<void> {
    try {
      const { id, roundNumber } = req.params;
      
      // Валидация ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid auction ID format' });
        return;
      }
      
      const leaderboard = await AuctionService.getRoundLeaderboard(
        id,
        parseInt(roundNumber)
      );
      res.json(leaderboard);
    } catch (error: any) {
      logger.error('Error getting leaderboard:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getUserBids(req: Request, res: Response): Promise<void> {
    try {
      const { id, userId } = req.params;
      
      // Валидация ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: 'Invalid auction ID format' });
        return;
      }
      
      const bids = await AuctionService.getUserBids(id, userId);
      res.json(bids);
    } catch (error: any) {
      logger.error('Error getting user bids:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async fixProblematicAuctions(_req: Request, res: Response): Promise<void> {
    try {
      const result = await AuctionService.fixProblematicAuctions();
      res.json(result);
    } catch (error: any) {
      logger.error('Error fixing auctions:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

export default new AuctionController();

