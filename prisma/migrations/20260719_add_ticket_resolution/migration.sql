-- Align DB with Prisma schema: Ticket.resolution (nullable text)
ALTER TABLE "ticket_support"."Ticket"
ADD COLUMN IF NOT EXISTS "resolution" TEXT;
