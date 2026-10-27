import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { AppError } from '../utils/AppError.js';

function publicUser(user) {
  return { id: user.id, email: user.email };
}

function signToken(user) {
  return jwt.sign({ email: user.email }, env.jwtSecret, {
    subject: user.id,
    expiresIn: env.jwtExpiresIn,
  });
}

function isDuplicateKey(err) {
  return err?.code === 11000;
}

export async function register({ email, password }) {
  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const session = await mongoose.startSession();

  let user;
  let wallet;

  try {
    session.startTransaction();

    const existing = await User.findOne({ email }).session(session);
    if (existing) {
      throw new AppError('Email is already registered', 409);
    }

    [user] = await User.create([{ email, passwordHash }], { session });
    [wallet] = await Wallet.create(
      [{ user: user._id, credits: env.defaultWalletCredits }],
      { session },
    );

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction().catch(() => {});

    if (err instanceof AppError) {
      throw err;
    }

    if (isDuplicateKey(err)) {
      throw new AppError('Email is already registered', 409);
    }

    throw err;
  } finally {
    await session.endSession();
  }

  return {
    user: publicUser(user),
    wallet: { credits: wallet.credits },
    token: signToken(user),
  };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw new AppError('Invalid email or password', 401);
  }

  const wallet = await Wallet.findOne({ user: user._id });
  if (!wallet) {
    throw new AppError('Wallet not found for this account', 500);
  }

  return {
    user: publicUser(user),
    wallet: { credits: wallet.credits },
    token: signToken(user),
  };
}

export async function getCurrentUser(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const wallet = await Wallet.findOne({ user: user._id });
  if (!wallet) {
    throw new AppError('Wallet not found for this account', 500);
  }

  return {
    user: publicUser(user),
    wallet: { credits: wallet.credits },
  };
}
