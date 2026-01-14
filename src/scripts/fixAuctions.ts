import dotenv from 'dotenv';
import Auction from '../models/Auction';
import { connectDatabase, disconnectDatabase } from '../config/database';
import logger from '../config/logger';

// Загрузить переменные окружения
dotenv.config();

/**
 * Скрипт для исправления проблемных аукционов:
 * - Помечает как завершенные аукционы, которые превысили максимальное количество раундов
 * - Помечает как завершенные аукционы, у которых все товары разыграны
 */
async function fixAuctions() {
  try {
    await connectDatabase();
    
    logger.info('Starting auction fix script...');
    
    // Получить все активные аукционы
    const activeAuctions = await Auction.find({ status: 'active' });
    logger.info(`Found ${activeAuctions.length} active auctions`);
    
    let fixedCount = 0;
    
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
      
      if (exceedsMaxRounds || allItemsWon) {
        logger.info(`Fixing auction ${auction._id}:`);
        logger.info(`  - Title: ${auction.title}`);
        logger.info(`  - Current round: ${auction.currentRound}, Max rounds: ${maxRounds}`);
        logger.info(`  - Total winners: ${totalWinners}, Total items: ${auction.totalItems}`);
        logger.info(`  - Exceeds max rounds: ${exceedsMaxRounds}`);
        logger.info(`  - All items won: ${allItemsWon}`);
        
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
        
        await auction.save();
        fixedCount++;
        logger.info(`  - Auction ${auction._id} marked as completed`);
      } else {
        // Проверить, нет ли лишних раундов в массиве rounds
        if (auction.rounds.length > maxRounds) {
          logger.info(`Fixing auction ${auction._id}: removing excess rounds`);
          logger.info(`  - Current rounds: ${auction.rounds.length}, Max rounds: ${maxRounds}`);
          
          // Оставить только нужные раунды
          auction.rounds = auction.rounds.slice(0, maxRounds);
          
          // Если currentRound больше maxRounds, установить его в maxRounds
          if (auction.currentRound > maxRounds) {
            auction.currentRound = maxRounds;
          }
          
          await auction.save();
          fixedCount++;
          logger.info(`  - Auction ${auction._id} fixed (removed excess rounds)`);
        }
      }
    }
    
    // Также проверить все аукционы на наличие проблемных раундов
    const allAuctions = await Auction.find({});
    logger.info(`Checking all ${allAuctions.length} auctions for issues...`);
    
    for (const auction of allAuctions) {
      const maxRounds = Math.ceil(auction.totalItems / auction.itemsPerRound);
      
      if (auction.rounds.length > maxRounds) {
        logger.info(`Auction ${auction._id} has ${auction.rounds.length} rounds but max should be ${maxRounds}`);
        logger.info(`  - Removing excess rounds...`);
        
        auction.rounds = auction.rounds.slice(0, maxRounds);
        
        if (auction.currentRound > maxRounds) {
          auction.currentRound = maxRounds;
          if (auction.status === 'active') {
            auction.status = 'completed';
            auction.completedAt = new Date();
          }
        }
        
        await auction.save();
        fixedCount++;
      }
    }
    
    logger.info(`Fix completed: ${fixedCount} auctions fixed`);
    logger.info(`Total auctions processed: ${activeAuctions.length + allAuctions.length}`);
    
  } catch (error) {
    logger.error('Error fixing auctions:', error);
    throw error;
  } finally {
    await disconnectDatabase();
  }
}

// Запустить скрипт
if (require.main === module) {
  fixAuctions()
    .then(() => {
      logger.info('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Script failed:', error);
      process.exit(1);
    });
}

export default fixAuctions;
