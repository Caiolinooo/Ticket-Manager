/**
 * Applies conversationId/memberIds columns on ExternalTrace if missing.
 * Safe to re-run (IF NOT EXISTS).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ticket_support"."ExternalTrace"
      ADD COLUMN IF NOT EXISTS "conversationId" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ticket_support"."ExternalTrace"
      ADD COLUMN IF NOT EXISTS "memberIds" TEXT
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ExternalTrace_platform_conversationId_status_idx"
      ON "ticket_support"."ExternalTrace" ("platform", "conversationId", "status")
  `);

  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'ticket_support'
      AND table_name = 'ExternalTrace'
      AND column_name IN ('conversationId', 'memberIds')
    ORDER BY column_name
  `);

  console.log('ExternalTrace grouping columns:', cols);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
