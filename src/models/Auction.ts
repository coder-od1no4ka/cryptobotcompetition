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
  itemsPerRound: number; // Количество товаров в каждом раунде
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

