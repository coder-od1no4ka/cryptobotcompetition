/**
 * Скрипт для нагрузочного тестирования системы аукционов
 * Создаёт несколько ботов, которые делают ставки одновременно
 */

import axios from 'axios';

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';

interface Bot {
  id: string;
  balance: number;
  active: boolean;
}

class LoadTester {
  private bots: Bot[] = [];
  private auctionId: string | null = null;
  private interval: NodeJS.Timeout | null = null;
  private stats = {
    totalBids: 0,
    successfulBids: 0,
    failedBids: 0,
    errors: [] as string[],
  };

  /**
   * Создать пользователя/бота
   */
  async createBot(botId: string): Promise<void> {
    try {
      // Создать пользователя
      await axios.post(`${API_BASE}/users/${botId}`, {
        username: `Bot ${botId}`,
      });

      // Пополнить баланс
      await axios.post(`${API_BASE}/users/${botId}/deposit`, {
        amount: 10000,
      });

      this.bots.push({
        id: botId,
        balance: 10000,
        active: true,
      });

      console.log(`✓ Bot ${botId} created`);
    } catch (error: any) {
      console.error(`✗ Failed to create bot ${botId}:`, error.message);
    }
  }

  /**
   * Создать аукцион для тестирования
   */
  async createTestAuction(): Promise<string> {
    try {
      const response = await axios.post(`${API_BASE}/auctions`, {
        title: 'Load Test Auction',
        description: 'Auction for load testing',
        totalItems: 10,
        itemsPerRound: 3,
        roundDuration: 60,
        minBid: 1,
        antiSnipingWindow: 10,
      });

      const auctionId = response.data._id;

      // Запустить аукцион
      await axios.post(`${API_BASE}/auctions/${auctionId}/start`);

      console.log(`✓ Test auction created: ${auctionId}`);
      return auctionId;
    } catch (error: any) {
      throw new Error(`Failed to create auction: ${error.message}`);
    }
  }

  /**
   * Разместить ставку от бота
   */
  async placeBid(botId: string, auctionId: string): Promise<void> {
    const bot = this.bots.find((b) => b.id === botId);
    if (!bot || !bot.active) {
      return;
    }

    try {
      const minBid = 1;
      const maxBid = 100;
      const bidAmount = minBid + Math.random() * (maxBid - minBid);

      await axios.post(`${API_BASE}/auctions/${auctionId}/bid`, {
        userId: botId,
        amount: Math.round(bidAmount * 100) / 100,
      });

      this.stats.successfulBids++;
      this.stats.totalBids++;
      bot.balance -= bidAmount;
    } catch (error: any) {
      this.stats.failedBids++;
      this.stats.totalBids++;
      
      if (error.response?.status === 400) {
        // Ожидаемые ошибки (недостаточно средств, раунд завершён и т.д.)
        // Не логируем их как критические
      } else {
        this.stats.errors.push(`${botId}: ${error.message}`);
        console.error(`✗ Bot ${botId} bid failed:`, error.message);
      }
    }
  }

  /**
   * Запустить нагрузочное тестирование
   */
  async start(
    botCount: number = 10,
    bidInterval: number = 1000,
    duration: number = 60000
  ): Promise<void> {
    console.log('🚀 Starting load test...');
    console.log(`Bots: ${botCount}, Interval: ${bidInterval}ms, Duration: ${duration}ms`);

    // Создать ботов
    console.log('\n📦 Creating bots...');
    for (let i = 0; i < botCount; i++) {
      await this.createBot(`load_test_bot_${Date.now()}_${i}`);
      // Небольшая задержка между созданием ботов
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Создать тестовый аукцион
    console.log('\n🏆 Creating test auction...');
    this.auctionId = await this.createTestAuction();

    // Запустить интервал для ставок
    console.log('\n💰 Starting bidding...');
    this.interval = setInterval(() => {
      if (!this.auctionId) return;

      // Каждый бот делает ставку
      this.bots.forEach((bot) => {
        if (bot.active) {
          this.placeBid(bot.id, this.auctionId!);
        }
      });
    }, bidInterval);

    // Остановить через указанное время
    setTimeout(() => {
      this.stop();
    }, duration);

    // Показывать статистику каждые 10 секунд
    const statsInterval = setInterval(() => {
      this.printStats();
    }, 10000);

    // Очистить интервал статистики при остановке
    setTimeout(() => {
      clearInterval(statsInterval);
    }, duration);
  }

  /**
   * Остановить тестирование
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.bots.forEach((bot) => {
      bot.active = false;
    });

    console.log('\n⏹️  Load test stopped');
    this.printStats();
  }

  /**
   * Вывести статистику
   */
  printStats(): void {
    console.log('\n📊 Statistics:');
    console.log(`Total bids: ${this.stats.totalBids}`);
    console.log(`Successful: ${this.stats.successfulBids}`);
    console.log(`Failed: ${this.stats.failedBids}`);
    console.log(`Success rate: ${this.stats.totalBids > 0 
      ? ((this.stats.successfulBids / this.stats.totalBids) * 100).toFixed(2) 
      : 0}%`);
    
    if (this.stats.errors.length > 0) {
      console.log(`\nErrors (last 5):`);
      this.stats.errors.slice(-5).forEach((error) => {
        console.log(`  - ${error}`);
      });
    }
  }
}

// Запуск, если файл выполняется напрямую
if (require.main === module) {
  const tester = new LoadTester();
  
  const botCount = parseInt(process.argv[2]) || 10;
  const bidInterval = parseInt(process.argv[3]) || 1000;
  const duration = parseInt(process.argv[4]) || 60000;

  tester.start(botCount, bidInterval, duration).catch((error) => {
    console.error('Load test failed:', error);
    process.exit(1);
  });
}

export default LoadTester;

