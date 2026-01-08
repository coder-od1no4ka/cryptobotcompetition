import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  userId: string;
  username?: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    username: {
      type: String,
    },
    balance: {
      type: Number,
      required: true,
      default: 1000, // Начальный баланс для демо
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IUser>('User', UserSchema);

