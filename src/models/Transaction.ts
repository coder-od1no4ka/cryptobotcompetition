import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
  userId: string;
  auctionId: string;
  type: 'bid' | 'refund' | 'win' | 'deposit';
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  description?: string;
  bidId?: string;
  roundNumber?: number;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema: Schema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    auctionId: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['bid', 'refund', 'win', 'deposit'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
    },
    description: {
      type: String,
    },
    bidId: {
      type: String,
    },
    roundNumber: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ auctionId: 1, createdAt: -1 });

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);

