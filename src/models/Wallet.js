import mongoose from 'mongoose';

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    credits: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: isNonNegativeInteger,
        message: 'credits must be a non-negative integer',
      },
    },
  },
  { timestamps: true },
);

export const Wallet = mongoose.model('Wallet', walletSchema);
