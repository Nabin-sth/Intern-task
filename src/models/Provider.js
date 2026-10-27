import mongoose from 'mongoose';

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

const providerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    priority: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'priority must be an integer (1 is tried first)',
      },
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: isNonNegativeInteger,
        message: 'balance must be a non-negative integer',
      },
    },
    failureRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

providerSchema.index({ priority: 1 });

export const Provider = mongoose.model('Provider', providerSchema);
