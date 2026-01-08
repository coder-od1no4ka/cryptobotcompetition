import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { connectDatabase } from './config/database';
import logger from './config/logger';
import auctionRoutes from './routes/auctionRoutes';
import userRoutes from './routes/userRoutes';
import { errorHandler } from './middleware/errorHandler';
import { startRoundProcessor } from './jobs/roundProcessor';

// Загрузить переменные окружения
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Для разработки
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static(path.join(__dirname, '../public')));

// Логирование запросов
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auctions', auctionRoutes);
app.use('/api/users', userRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API info endpoint
app.get('/api', (_req, res) => {
  res.json({
    message: 'CryptoBot Auction API',
    version: '1.0.0',
    endpoints: {
      auctions: '/api/auctions',
      users: '/api/users',
      health: '/health',
    },
  });
});

// Serve static files (UI) - должно быть после API routes
// Корневой маршрут будет обслуживать index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling
app.use(errorHandler);

// Запуск сервера
const startServer = async (): Promise<void> => {
  try {
    // Подключиться к базе данных
    await connectDatabase();
    
    // Запустить обработчик раундов
    startRoundProcessor();
    
    // Запустить сервер
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

