import User, { IUser } from '../models/User';
import Transaction from '../models/Transaction';
import logger from '../config/logger';

export class UserService {
  /**
   * Создать или получить пользователя
   */
  async getOrCreateUser(userId: string, username?: string): Promise<IUser> {
    let user = await User.findOne({ userId });
    
    if (!user) {
      user = new User({
        userId,
        username,
        balance: 1000, // Начальный баланс для демо
      });
      await user.save();
      logger.info(`Created new user: ${userId}`);
    }
    
    return user;
  }

  /**
   * Получить пользователя по ID
   */
  async getUserById(userId: string): Promise<IUser | null> {
    return User.findOne({ userId });
  }

  /**
   * Обновить баланс пользователя
   */
  async updateBalance(
    userId: string,
    amount: number,
    type: 'add' | 'subtract'
  ): Promise<IUser | null> {
    const user = await User.findOne({ userId });
    
    if (!user) {
      throw new Error('User not found');
    }

    if (type === 'subtract' && user.balance < amount) {
      throw new Error('Insufficient balance');
    }

    user.balance = type === 'add' 
      ? user.balance + amount 
      : user.balance - amount;

    await user.save();
    return user;
  }

  /**
   * Получить баланс пользователя
   */
  async getBalance(userId: string): Promise<number> {
    const user = await User.findOne({ userId });
    return user?.balance || 0;
  }

  /**
   * Получить историю транзакций пользователя
   */
  async getTransactionHistory(userId: string, limit: number = 50) {
    return Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Пополнить баланс (для демо)
   */
  async deposit(userId: string, amount: number): Promise<IUser> {
    await this.getOrCreateUser(userId);
    
    await this.updateBalance(userId, amount, 'add');
    
    // Создать транзакцию
    await Transaction.create({
      userId,
      auctionId: 'deposit',
      type: 'deposit',
      amount,
      status: 'completed',
      description: 'Balance deposit',
    });

    return (await this.getUserById(userId))!;
  }
}

export default new UserService();

