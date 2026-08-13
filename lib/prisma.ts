import { PrismaClient } from '@prisma/client';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
