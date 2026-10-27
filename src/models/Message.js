import mongoose from 'mongoose';

export const MESSAGE_STATUSES = ['pending', 'sent', 'failed'];
export const MESSAGE_ENCODINGS = ['gsm7', 'unicode'];

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

const providerAttemptSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
    },
    providerName: {
      type: String,
      required: true,
      trim: true,
    },
    success: {
      type: Boolean,
      required: true,
    },
    error: {
      type: String,
      trim: true,
    },
    attemptedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      match: [/^(97|98)\d{8}$/, 'phone must be a normalised 10-digit Nepali mobile number'],
    },
    body: {
      type: String,
      required: true,
      maxlength: 4096,
    },
    encoding: {
      type: String,
      required: true,
      enum: MESSAGE_ENCODINGS,
    },
    parts: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: isPositiveInteger,
        message: 'parts must be a positive integer',
      },
    },
    cost: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isNonNegativeInteger,
        message: 'cost must be a non-negative integer',
      },
    },
    status: {
      type: String,
      required: true,
      enum: MESSAGE_STATUSES,
      default: 'pending',
      index: true,
    },
    charged: {
      type: Boolean,
      required: true,
      default: false,
    },
    refunded: {
      type: Boolean,
      required: true,
      default: false,
    },
    sentVia: {
      type: String,
      trim: true,
    },
    providerAttempts: {
      type: [providerAttemptSchema],
      default: [],
    },
  },
  { timestamps: true },
);

messageSchema.index({ user: 1, createdAt: -1 });
messageSchema.index({ user: 1, status: 1, createdAt: -1 });
messageSchema.index({ user: 1, phone: 1, createdAt: -1 });
messageSchema.index({ sentVia: 1, createdAt: -1, status: 1 });
messageSchema.index({ status: 1, charged: 1, refunded: 1, updatedAt: 1 });

export const Message = mongoose.model('Message', messageSchema);
