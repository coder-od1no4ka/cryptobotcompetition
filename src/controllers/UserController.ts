import { Request, Response } from 'express';
import UserService from '../services/UserService';
import logger from '../config/logger';

export class UserController {
  async getUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const user = await UserService.getUserById(userId);
      
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      
      res.json(user);
    } catch (error: any) {
      logger.error('Error getting user:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getOrCreateUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { username } = req.body;
      const user = await UserService.getOrCreateUser(userId, username);
      res.json(user);
    } catch (error: any) {
      logger.error('Error getting/creating user:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getBalance(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const balance = await UserService.getBalance(userId);
      res.json({ userId, balance });
    } catch (error: any) {
      logger.error('Error getting balance:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async deposit(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { amount } = req.body;
      
      if (!amount || amount <= 0) {
        res.status(400).json({ error: 'Valid amount is required' });
        return;
      }

      const user = await UserService.deposit(userId, amount);
      res.json(user);
    } catch (error: any) {
      logger.error('Error depositing:', error);
      res.status(400).json({ error: error.message });
    }
  }

  async getTransactionHistory(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const transactions = await UserService.getTransactionHistory(userId, limit);
      res.json(transactions);
    } catch (error: any) {
      logger.error('Error getting transaction history:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

export default new UserController();

