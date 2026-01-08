import mongoose from 'mongoose';
import Auction, { IAuction, IBid } from '../models/Auction';
import UserService from './UserService';
import Transaction from '../models/Transaction';
import logger from '../config/logger';

export interface CreateAuctionDto {
  title: string;
  description?: string;
  totalItems: number;
  itemsPerRound: number;
  roundDuration: number;
  minBid: number;
  antiSnipingWindow?: number;
}

export class AuctionService {
  /**
   * Создать новый аукцион
   */
  async createAuction(data: CreateAuctionDto): Promise<IAuction> {
    const auction = new Auction({
      ...data,
      antiSnipingWindow: data.antiSnipingWindow || 10,
      status: 'draft',
      currentRound: 1,
      rounds: [],
      bids: [],
    });

    await auction.save();
    logger.info(`Created auction: ${auction._id}`);
    return auction;
  }

  /**
   * Запустить аукцион
   */
  async startAuction(auctionId: string): Promise<IAuction> {
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      throw new Error('Invalid auction ID format');
    }
    
    const auction = await Auction.findById(auctionId);
    
    if (!auction) {
      throw new Error('Auction not found');
    }

    if (auction.status !== 'draft') {
      throw new Error('Auction cannot be started');
    }

    // Создать первый раунд
    auction.status = 'active';
    auction.startedAt = new Date();
    auction.currentRound = 1;
    auction.rounds = [{
      roundNumber: 1,
      startTime: new Date(),
      endTime: new Date(Date.now() + auction.roundDuration * 1000),
      status: 'active',
      winners: [],
      totalBids: 0,
    }] as any;

    await auction.save();
    logger.info(`Started auction: ${auctionId}`);
    return auction;
  }

  /**
   * Разместить ставку
   */
  async placeBid(
    auctionId: string,
    userId: string,
    amount: number
  ): Promise<IBid> {
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      throw new Error('Invalid auction ID format');
    }
    
    const auction = await Auction.findById(auctionId);
    
    if (!auction) {
      throw new Error('Auction not found');
    }

    if (auction.status !== 'active') {
      throw new Error('Auction is not active');
    }

    if (amount < auction.minBid) {
      throw new Error(`Bid must be at least ${auction.minBid}`);
    }

    // Проверить баланс
    const user = await UserService.getUserById(userId);
    if (!user || user.balance < amount) {
      throw new Error('Insufficient balance');
    }

    const currentRound = auction.rounds[auction.currentRound - 1];
    
    if (!currentRound || currentRound.status !== 'active') {
      throw new Error('Current round is not active');
    }

    // Проверить, не истёк ли раунд
    const now = new Date();
    if (now >= currentRound.endTime) {
      throw new Error('Round has ended');
    }

    // Создать ставку
    const bid: IBid = {
      userId,
      amount,
      timestamp: now,
      roundNumber: auction.currentRound,
    } as IBid;

    auction.bids.push(bid);
    currentRound.totalBids += 1;

    // Anti-sniping: продлить раунд ТОЛЬКО если ставка входит в топ
    // По механике Telegram: "Если в топ-3 перебивают ставку, добавляется 30 секунд"
    const timeUntilEnd = currentRound.endTime.getTime() - now.getTime();
    const antiSnipingMs = auction.antiSnipingWindow * 1000;
    
    if (timeUntilEnd <= antiSnipingMs) {
      // Проверить, входит ли ставка в топ (топ-N, где N = itemsPerRound)
      const roundBids = auction.bids.filter(
        (b) => b.roundNumber === auction.currentRound
      );
      
      // Группировать по пользователям (максимальная ставка)
      const userBids = new Map<string, IBid>();
      for (const b of roundBids) {
        const existing = userBids.get(b.userId);
        if (!existing || b.amount > existing.amount) {
          userBids.set(b.userId, b);
        }
      }
      
      // Отсортировать и проверить, входит ли новая ставка в топ
      const sortedBids = Array.from(userBids.values()).sort((a, b) => {
        if (b.amount !== a.amount) {
          return b.amount - a.amount;
        }
        return a.timestamp.getTime() - b.timestamp.getTime();
      });
      
      // Проверить, входит ли ставка пользователя в топ
      const userTopBidIndex = sortedBids.findIndex((b) => b.userId === userId);
      if (userTopBidIndex >= 0 && userTopBidIndex < auction.itemsPerRound) {
        // Ставка входит в топ - продлить раунд
        // Но не продлеваем бесконечно - максимум до удвоенного времени раунда
        const maxEndTime = new Date(currentRound.startTime.getTime() + auction.roundDuration * 2000);
        const newEndTime = new Date(now.getTime() + antiSnipingMs);
        
        if (newEndTime <= maxEndTime) {
          currentRound.endTime = newEndTime;
          logger.info(`Extended round ${auction.currentRound} due to anti-sniping (bid in top-${auction.itemsPerRound})`);
        } else {
          logger.info(`Round ${auction.currentRound} reached max extension time`);
        }
      }
    }

    // Списать средства
    await UserService.updateBalance(userId, amount, 'subtract');
    
    // Создать транзакцию
    await Transaction.create({
      userId,
      auctionId: auctionId.toString(),
      type: 'bid',
      amount,
      status: 'completed',
      bidId: bid._id?.toString(),
      roundNumber: auction.currentRound,
      description: `Bid on auction ${auction.title}`,
    });

    await auction.save();
    logger.info(`Bid placed: ${userId} bid ${amount} on auction ${auctionId}`);
    
    return bid;
  }

  /**
   * Завершить текущий раунд и определить победителей
   */
  async completeRound(auctionId: string): Promise<IAuction> {
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      throw new Error('Invalid auction ID format');
    }
    
    const auction = await Auction.findById(auctionId);
    
    if (!auction) {
      throw new Error('Auction not found');
    }

    const currentRound = auction.rounds[auction.currentRound - 1];
    
    if (!currentRound || currentRound.status !== 'active') {
      throw new Error('Current round is not active');
    }

    const now = new Date();
    if (now < currentRound.endTime) {
      throw new Error('Round has not ended yet');
    }

    // Получить все ставки текущего раунда
    const roundBids = auction.bids.filter(
      (bid) => bid.roundNumber === auction.currentRound
    );

    // Группировать ставки по пользователям (брать максимальную ставку каждого пользователя)
    const userBids = new Map<string, IBid>();
    
    for (const bid of roundBids) {
      const existingBid = userBids.get(bid.userId);
      if (!existingBid || bid.amount > existingBid.amount) {
        userBids.set(bid.userId, bid);
      }
    }

    // Отсортировать по сумме ставки (по убыванию), затем по времени (по возрастанию)
    const sortedBids = Array.from(userBids.values()).sort((a, b) => {
      if (b.amount !== a.amount) {
        return b.amount - a.amount;
      }
      return a.timestamp.getTime() - b.timestamp.getTime();
    });

    // Определить победителей
    const winners = sortedBids
      .slice(0, auction.itemsPerRound)
      .map((bid, index) => ({
        userId: bid.userId,
        bidAmount: bid.amount,
        position: index + 1,
      }));

    const winnerUserIds = new Set(winners.map((w) => w.userId));
    const winnerMaxBids = new Map<string, number>();
    
    // Сохранить максимальные ставки победителей
    winners.forEach((winner) => {
      winnerMaxBids.set(winner.userId, winner.bidAmount);
    });

    // По механике Telegram: "невыигравшие ставки автоматически переносятся в следующий раунд"
    // Победители получают товар и их ставки списываются
    // Проигравшие ставки переносятся в следующий раунд (не возвращаются сразу)
    
    // Вернуть дополнительные ставки победителей (кроме максимальной)
    for (const bid of roundBids) {
      if (winnerUserIds.has(bid.userId)) {
        const maxBid = winnerMaxBids.get(bid.userId);
        if (maxBid && bid.amount < maxBid) {
          // Это дополнительная ставка победителя - вернуть
          await UserService.updateBalance(bid.userId, bid.amount, 'add');
          
          await Transaction.create({
            userId: bid.userId,
            auctionId: auctionId.toString(),
            type: 'refund',
            amount: bid.amount,
            status: 'completed',
            bidId: bid._id?.toString(),
            roundNumber: auction.currentRound,
            description: `Refund for additional bid in round ${auction.currentRound}`,
          });
        }
      }
      // Проигравшие ставки НЕ возвращаются - они переносятся в следующий раунд
    }

    // Обновить раунд
    currentRound.status = 'completed';
    currentRound.winners = winners;

    // Проверить, нужно ли создать следующий раунд
    // Считаем общее количество победителей (включая текущий раунд)
    const totalWinners = auction.rounds.reduce(
      (sum, round) => sum + (round.winners?.length || 0),
      0
    );

    // Проверяем, все ли товары разыграны
    if (totalWinners < auction.totalItems) {
      // Создать следующий раунд
      const nextRoundNumber = auction.currentRound + 1;
      const nextRound = {
        roundNumber: nextRoundNumber,
        startTime: new Date(),
        endTime: new Date(Date.now() + auction.roundDuration * 1000),
        status: 'active' as const,
        winners: [],
        totalBids: 0,
      };
      
      auction.rounds.push(nextRound as any);
      auction.currentRound = nextRoundNumber;
      
      // По механике Telegram: "невыигравшие ставки автоматически переносятся в следующий раунд в исходном размере"
      for (const bid of roundBids) {
        if (!winnerUserIds.has(bid.userId)) {
          // Перенести ставку в следующий раунд
          const nextRoundBid: IBid = {
            userId: bid.userId,
            amount: bid.amount, // В исходном размере
            timestamp: bid.timestamp, // Сохраняем оригинальное время
            roundNumber: nextRoundNumber,
          } as IBid;
          
          auction.bids.push(nextRoundBid);
          nextRound.totalBids += 1;
        }
      }
    } else {
      // Аукцион завершён
      auction.status = 'completed';
      auction.completedAt = new Date();
      
      // По механике Telegram: "если предложение ни разу не вошло в топ, деньги возвращаются пользователю обратно"
      // Вернуть деньги всем ставкам, которые ни разу не вошли в топ за все раунды
      const allWinnerUserIds = new Set<string>();
      auction.rounds.forEach((round) => {
        if (round.winners) {
          round.winners.forEach((winner) => {
            allWinnerUserIds.add(winner.userId);
          });
        }
      });
      
      // Вернуть деньги проигравшим ставкам, которые ни разу не вошли в топ
      for (const bid of auction.bids) {
        if (!allWinnerUserIds.has(bid.userId)) {
          // Эта ставка ни разу не вошла в топ - вернуть деньги
          await UserService.updateBalance(bid.userId, bid.amount, 'add');
          
          await Transaction.create({
            userId: bid.userId,
            auctionId: auctionId.toString(),
            type: 'refund',
            amount: bid.amount,
            status: 'completed',
            bidId: bid._id?.toString(),
            roundNumber: bid.roundNumber,
            description: `Refund for bid that never entered top in auction ${auction.title}`,
          });
        }
      }
    }

    await auction.save();
    logger.info(`Completed round ${currentRound.roundNumber} of auction ${auctionId}`);
    
    return auction;
  }

  /**
   * Получить аукцион по ID
   */
  async getAuctionById(auctionId: string): Promise<IAuction | null> {
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      throw new Error('Invalid auction ID format');
    }
    
    return Auction.findById(auctionId);
  }

  /**
   * Получить все активные аукционы
   */
  async getActiveAuctions(): Promise<IAuction[]> {
    return Auction.find({ status: 'active' }).sort({ createdAt: -1 });
  }

  /**
   * Получить все аукционы
   */
  async getAllAuctions(limit: number = 50): Promise<IAuction[]> {
    return Auction.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Получить ставки пользователя в аукционе
   */
  async getUserBids(auctionId: string, userId: string): Promise<IBid[]> {
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      throw new Error('Invalid auction ID format');
    }
    
    const auction = await Auction.findById(auctionId);
    
    if (!auction) {
      throw new Error('Auction not found');
    }

    return auction.bids.filter(
      (bid) => bid.userId === userId
    );
  }

  /**
   * Получить топ ставок раунда
   */
  async getRoundLeaderboard(
    auctionId: string,
    roundNumber: number
  ): Promise<Array<{ userId: string; amount: number; timestamp: Date }>> {
    if (!mongoose.Types.ObjectId.isValid(auctionId)) {
      throw new Error('Invalid auction ID format');
    }
    
    const auction = await Auction.findById(auctionId);
    
    if (!auction) {
      throw new Error('Auction not found');
    }

    const roundBids = auction.bids.filter(
      (bid) => bid.roundNumber === roundNumber
    );

    // Группировать по пользователям и брать максимальную ставку
    const userBids = new Map<string, IBid>();
    
    for (const bid of roundBids) {
      const existingBid = userBids.get(bid.userId);
      if (!existingBid || bid.amount > existingBid.amount) {
        userBids.set(bid.userId, bid);
      }
    }

    return Array.from(userBids.values())
      .sort((a, b) => {
        if (b.amount !== a.amount) {
          return b.amount - a.amount;
        }
        return a.timestamp.getTime() - b.timestamp.getTime();
      })
      .map((bid) => ({
        userId: bid.userId,
        amount: bid.amount,
        timestamp: bid.timestamp,
      }));
  }
}

export default new AuctionService();

