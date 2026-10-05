-- Fix: rename idCardHash to idCardHash_deprecated to match Prisma schema
ALTER TABLE users RENAME COLUMN "idCardHash" TO "idCardHash_deprecated";
