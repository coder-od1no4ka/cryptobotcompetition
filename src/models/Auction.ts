import mongoose, { Schema, Document } from 'mongoose';

export interface IBid extends Document {
  userId: string;
  amount: number;
  timestamp: Date;
  roundNumber: number;
}

export interface IRound extends Document {
  roundNumber: number;
  startTime: Date;
  endTime: Date;
  status: 'pending' | 'active' | 'completed';
  winningSlots: number; // Количество победных мест в этом раунде
  winners: Array<{
    userId: string;
    bidAmount: number;
    position: number;
  }>;
  totalBids: number;
}

export interface IAuction extends Document {
  title: string;
  description?: string;
  totalItems: number; // Общее количество товаров
  itemsPerRound: number; // Количество товаров в каждом раунде (по умолчанию, если не указан winnersPerRound)
  winnersPerRound?: number[]; // Массив количества победителей для каждого раунда (опционально)
  roundDuration: number; // Длительность раунда в секундах
  minBid: number;
  antiSnipingWindow: number; // Окно продления раунда при последней ставке (в секундах)
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  currentRound: number;
  rounds: IRound[];
  bids: IBid[];
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

const BidSchema: Schema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    roundNumber: {
      type: Number,
      required: true,
      index: true,
    },
  },
  { _id: true }
);

const RoundSchema: Schema = new Schema(
  {
    roundNumber: {
      type: Number,
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'completed'],
      default: 'pending',
    },
    winningSlots: {
      type: Number,
      required: false, // Необязательно для обратной совместимости
      min: 1,
    },
    winners: [
      {
        userId: String,
        bidAmount: Number,
        position: Number,
      },
    ],
    totalBids: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

const AuctionSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    totalItems: {
      type: Number,
      required: true,
      min: 1,
    },
    itemsPerRound: {
      type: Number,
      required: true,
      min: 1,
    },
    winnersPerRound: {
      type: [Number],
      required: false,
      validate: {
        validator: function(arr: number[]) {
          if (!arr || arr.length === 0) return true; // Опционально
          if (!arr.every((val: number) => val > 0)) return false;
          // totalItems будет доступен через this
          const totalItems = (this as any).totalItems;
          if (!totalItems) return true; // Если totalItems еще не установлен, пропускаем валидацию
          const sum = arr.reduce((s: number, val: number) => s + val, 0);
          return sum === totalItems;
        },
        message: 'Сумма победителей по раундам должна равняться totalItems, каждое значение должно быть > 0',
      },
    },
    roundDuration: {
      type: Number,
      required: true,
      min: 10, // Минимум 10 секунд
      default: 60, // По умолчанию 60 секунд
    },
    minBid: {
      type: Number,
      required: true,
      min: 0,
      default: 1,
    },
    antiSnipingWindow: {
      type: Number,
      required: true,
      min: 0,
      default: 10, // По умолчанию 10 секунд
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'cancelled'],
      default: 'draft',
    },
    currentRound: {
      type: Number,
      default: 1,
    },
    rounds: [RoundSchema],
    bids: [BidSchema],
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Индексы для оптимизации запросов
AuctionSchema.index({ status: 1, currentRound: 1 });
AuctionSchema.index({ 'bids.userId': 1, 'bids.roundNumber': 1 });
AuctionSchema.index({ 'rounds.roundNumber': 1 });

export default mongoose.model<IAuction>('Auction', AuctionSchema);

