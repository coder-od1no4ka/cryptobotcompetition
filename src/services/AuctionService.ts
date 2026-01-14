import mongoose from 'mongoose';
import Auction, { IAuction, IBid } from '../models/Auction';
import UserService from './UserService';
import Transaction from '../models/Transaction';
import logger from '../config/logger';

export interface CreateAuctionDto {
  title: string;
  description?: string;
  totalItems: number;
  itemsPerRound: number; // Используется, если winnersPerRound не указан
  winnersPerRound?: number[]; // Массив количества победителей для каждого раунда
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

    // Вычислить количество раундов и победных мест для каждого раунда
    let maxRounds: number;
    let winnersPerRound: number[];
    
    if (auction.winnersPerRound && auction.winnersPerRound.length > 0) {
      // Использовать указанный массив winnersPerRound
      maxRounds = auction.winnersPerRound.length;
      winnersPerRound = auction.winnersPerRound;
    } else {
      // Использовать itemsPerRound для всех раундов
      maxRounds = Math.ceil(auction.totalItems / auction.itemsPerRound);
      winnersPerRound = [];
      let remainingItems = auction.totalItems;
      for (let i = 0; i < maxRounds; i++) {
        winnersPerRound.push(Math.min(auction.itemsPerRound, remainingItems));
        remainingItems -= winnersPerRound[i];
      }
    }
    
    // Создать первый раунд
    const firstRoundWinningSlots = winnersPerRound[0] || auction.itemsPerRound;
    
    auction.status = 'active';
    auction.startedAt = new Date();
    auction.currentRound = 1;
    auction.rounds = [{
      roundNumber: 1,
      startTime: new Date(),
      endTime: new Date(Date.now() + auction.roundDuration * 1000),
      status: 'active',
      winningSlots: firstRoundWinningSlots,
      winners: [],
      totalBids: 0,
    }] as any;

    await auction.save();
    logger.info(`Started auction: ${auctionId}, max rounds: ${maxRounds}, winners per round: ${winnersPerRound.join(', ')}`);
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
    // По механике Telegram: "Если в топ-N перебивают ставку, добавляется N секунд"
    const timeUntilEnd = currentRound.endTime.getTime() - now.getTime();
    const antiSnipingMs = auction.antiSnipingWindow * 1000;
    
    // Получить количество победных мест в текущем раунде
    const winningSlots = currentRound.winningSlots || auction.itemsPerRound;
    
    if (timeUntilEnd <= antiSnipingMs) {
      // Проверить, входит ли ставка в топ (топ-N, где N = winningSlots текущего раунда)
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
      if (userTopBidIndex >= 0 && userTopBidIndex < winningSlots) {
        // Ставка входит в топ - продлить раунд
        // Но не продлеваем бесконечно - максимум до удвоенного времени раунда
        const maxEndTime = new Date(currentRound.startTime.getTime() + auction.roundDuration * 2000);
        const newEndTime = new Date(now.getTime() + antiSnipingMs);
        
        if (newEndTime <= maxEndTime) {
          currentRound.endTime = newEndTime;
          logger.info(`Extended round ${auction.currentRound} due to anti-sniping (bid in top-${winningSlots})`);
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

    // Определить количество победных мест в текущем раунде
    const winningSlots = currentRound.winningSlots || auction.itemsPerRound;
    
    // Определить победителей (только топ-N, где N = winningSlots)
    const winners = sortedBids
      .slice(0, winningSlots)
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
    // Победители получают товар и их ставки списываются (остаются списанными - это оплата за товар)
    // Проигравшие ставки переносятся в следующий раунд (не возвращаются сразу)
    
    // Вернуть дополнительные ставки победителей (кроме максимальной выигрышной ставки)
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
        // Максимальная ставка победителя остается списанной (оплата за товар)
      }
      // Проигравшие ставки НЕ возвращаются - они переносятся в следующий раунд
    }

    // Обновить раунд
    currentRound.status = 'completed';
    currentRound.winners = winners;

    // Проверить, нужно ли создать следующий раунд
    // Считаем общее количество победителей (включая текущий раунд)
    // currentRound - это ссылка на объект в auction.rounds, поэтому winners уже обновлены
    const totalWinners = auction.rounds.reduce(
      (sum, round) => sum + (round.winners?.length || 0),
      0
    );

    // Вычислить максимальное количество раундов и winnersPerRound
    let maxRounds: number;
    let winnersPerRound: number[];
    
    if (auction.winnersPerRound && auction.winnersPerRound.length > 0) {
      maxRounds = auction.winnersPerRound.length;
      winnersPerRound = auction.winnersPerRound;
    } else {
      maxRounds = Math.ceil(auction.totalItems / auction.itemsPerRound);
      winnersPerRound = [];
      let remainingItems = auction.totalItems;
      for (let i = 0; i < maxRounds; i++) {
        winnersPerRound.push(Math.min(auction.itemsPerRound, remainingItems));
        remainingItems -= winnersPerRound[i];
      }
    }
    
    // КРИТИЧЕСКАЯ ПРОВЕРКА: убедиться, что не превышен лимит раундов
    if (auction.currentRound > maxRounds) {
      // Аукцион уже превысил максимальное количество раундов - завершить немедленно
      logger.warn(`Auction ${auctionId} exceeded max rounds (${auction.currentRound} > ${maxRounds}). Marking as completed.`);
      auction.status = 'completed';
      auction.completedAt = new Date();
      await auction.save();
      return auction;
    }
    
    // Проверяем, все ли товары разыграны И не превышен ли лимит раундов
    // Важно: проверяем строго меньше (<), так как если currentRound уже равен maxRounds, это последний раунд
    if (totalWinners < auction.totalItems && auction.currentRound < maxRounds) {
      // Создать следующий раунд
      const nextRoundNumber = auction.currentRound + 1;
      
      // Вычислить количество победных мест в следующем раунде
      const nextRoundWinningSlots = winnersPerRound[nextRoundNumber - 1] || Math.min(auction.itemsPerRound, auction.totalItems - totalWinners);
      
      const nextRound = {
        roundNumber: nextRoundNumber,
        startTime: new Date(),
        endTime: new Date(Date.now() + auction.roundDuration * 1000),
        status: 'active' as const,
        winningSlots: nextRoundWinningSlots,
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
      // Аукцион завершён (либо все товары разыграны, либо достигнут максимум раундов)
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
   * Фильтрует только действительно активные аукционы (статус 'active' и есть активный раунд)
   */
  async getActiveAuctions(): Promise<IAuction[]> {
    const activeAuctions = await Auction.find({ status: 'active' }).sort({ createdAt: -1 });
    
    // Дополнительная фильтрация: проверяем, что у аукциона есть активный раунд
    // и что аукцион не завершен (все товары не разыграны, не достигнут максимум раундов)
    const filteredAuctions = activeAuctions.filter((auction) => {
      const currentRound = auction.rounds[auction.currentRound - 1];
      
      // Если нет текущего раунда, аукцион неактивен
      if (!currentRound) {
        return false;
      }
      
      // Если текущий раунд не активен, аукцион неактивен
      if (currentRound.status !== 'active') {
        return false;
      }
      
      // Проверить, не завершен ли аукцион
      const totalWinners = auction.rounds.reduce(
        (sum, round) => sum + (round.winners?.length || 0),
        0
      );
      
      // Вычислить maxRounds с учетом winnersPerRound
      let maxRounds: number;
      if (auction.winnersPerRound && auction.winnersPerRound.length > 0) {
        maxRounds = auction.winnersPerRound.length;
      } else {
        maxRounds = Math.ceil(auction.totalItems / auction.itemsPerRound);
      }
      
      // Если все товары разыграны или достигнут максимум раундов - аукцион завершен
      if (totalWinners >= auction.totalItems || auction.currentRound >= maxRounds) {
        // Пометить аукцион как завершенный, если еще не помечен
        if (auction.status === 'active') {
          auction.status = 'completed';
          auction.completedAt = new Date();
          auction.save().catch((err) => logger.error('Error marking auction as completed:', err));
        }
        return false;
      }
      
      return true;
    });
    
    return filteredAuctions;
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
   * Исправить проблемные аукционы
   * Помечает как завершенные аукционы, которые превысили максимальное количество раундов
   */
  async fixProblematicAuctions(): Promise<{ fixed: number; deleted: number; message: string }> {
    let fixedCount = 0;
    
    // Получить все активные аукционы
    const activeAuctions = await Auction.find({ status: 'active' });
    logger.info(`Checking ${activeAuctions.length} active auctions for issues...`);
    
    for (const auction of activeAuctions) {
      const maxRounds = Math.ceil(auction.totalItems / auction.itemsPerRound);
      const totalWinners = auction.rounds.reduce(
        (sum, round) => sum + (round.winners?.length || 0),
        0
      );
      
      // Проверить, не превышено ли максимальное количество раундов
      const exceedsMaxRounds = auction.currentRound > maxRounds;
      
      // Проверить, не разыграны ли все товары
      const allItemsWon = totalWinners >= auction.totalItems;
      
      if (exceedsMaxRounds || allItemsWon || auction.rounds.length > maxRounds) {
        logger.info(`Fixing auction ${auction._id}: currentRound=${auction.currentRound}, maxRounds=${maxRounds}, rounds.length=${auction.rounds.length}`);
        
        // Удалить лишние раунды
        if (auction.rounds.length > maxRounds) {
          auction.rounds = auction.rounds.slice(0, maxRounds);
        }
        
        // Добавить winningSlots к раундам, где его нет
        for (let i = 0; i < auction.rounds.length; i++) {
          const round = auction.rounds[i];
          if (!round.winningSlots) {
            // Вычислить количество победных мест для этого раунда
            const roundNumber = i + 1;
            const winnersBefore = auction.rounds.slice(0, i).reduce(
              (sum, r) => sum + (r.winners?.length || 0),
              0
            );
            const remainingItems = auction.totalItems - winnersBefore;
            round.winningSlots = roundNumber === maxRounds 
              ? Math.min(auction.itemsPerRound, remainingItems)
              : auction.itemsPerRound;
          }
        }
        
        // Пометить как завершенный
        auction.status = 'completed';
        auction.completedAt = new Date();
        
        // Если текущий раунд активен, завершить его
        const currentRound = auction.rounds[auction.currentRound - 1];
        if (currentRound && currentRound.status === 'active') {
          currentRound.status = 'completed';
          if (!currentRound.endTime || currentRound.endTime > new Date()) {
            currentRound.endTime = new Date();
          }
        }
        
        // Установить currentRound в максимум, если он больше
        if (auction.currentRound > maxRounds) {
          auction.currentRound = maxRounds;
        }
        
        await auction.save();
        fixedCount++;
        logger.info(`Auction ${auction._id} fixed and marked as completed`);
      }
    }
    
    // Также проверить все аукционы на наличие проблемных раундов
    const allAuctions = await Auction.find({});
    
    for (const auction of allAuctions) {
      const maxRounds = Math.ceil(auction.totalItems / auction.itemsPerRound);
      
      if (auction.rounds.length > maxRounds) {
        logger.info(`Fixing auction ${auction._id}: removing ${auction.rounds.length - maxRounds} excess rounds`);
        
        auction.rounds = auction.rounds.slice(0, maxRounds);
        
        if (auction.currentRound > maxRounds) {
          auction.currentRound = maxRounds;
          if (auction.status === 'active') {
            auction.status = 'completed';
            auction.completedAt = new Date();
          }
        }
        
        // Добавить winningSlots к раундам, где его нет
        for (let i = 0; i < auction.rounds.length; i++) {
          const round = auction.rounds[i];
          if (!round.winningSlots) {
            const roundNumber = i + 1;
            const winnersBefore = auction.rounds.slice(0, i).reduce(
              (sum, r) => sum + (r.winners?.length || 0),
              0
            );
            const remainingItems = auction.totalItems - winnersBefore;
            round.winningSlots = roundNumber === maxRounds 
              ? Math.min(auction.itemsPerRound, remainingItems)
              : auction.itemsPerRound;
          }
        }
        
        await auction.save();
        fixedCount++;
      }
    }
    
    logger.info(`Fix completed: ${fixedCount} auctions fixed`);
    
    return {
      fixed: fixedCount,
      deleted: 0,
      message: `Fixed ${fixedCount} problematic auction(s)`
    };
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

