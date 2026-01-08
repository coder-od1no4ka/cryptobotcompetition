import cron from 'node-cron';
import AuctionService from '../services/AuctionService';
import Auction from '../models/Auction';
import logger from '../config/logger';

/**
 * Cron-задача для автоматического завершения раундов
 * Запускается каждые 5 секунд для проверки истёкших раундов
 */
export const startRoundProcessor = (): void => {
  cron.schedule('*/5 * * * * *', async () => {
    try {
      // Найти все активные аукционы
      const activeAuctions = await Auction.find({ status: 'active' });
      
      for (const auction of activeAuctions) {
        const currentRound = auction.rounds[auction.currentRound - 1];
        
        if (!currentRound || currentRound.status !== 'active') {
          continue;
        }

        const now = new Date();
        
        // Проверить, истёк ли раунд
        if (now >= currentRound.endTime) {
          try {
            logger.info(`Auto-completing round ${auction.currentRound} of auction ${auction._id}`);
            await AuctionService.completeRound(auction._id.toString());
          } catch (error: any) {
            logger.error(`Error auto-completing round for auction ${auction._id}:`, error);
          }
        }
      }
    } catch (error: any) {
      logger.error('Error in round processor:', error);
    }
  });

  logger.info('Round processor started');
};

