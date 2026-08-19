import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    path: process.env.DATABASE_PATH || './data/mentions.db',
  },
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
} as const;
