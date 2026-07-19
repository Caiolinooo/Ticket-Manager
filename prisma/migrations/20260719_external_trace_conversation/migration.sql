-- Grouping context for Teams/Exchange traces (conversation + merged message ids)
ALTER TABLE "ticket_support"."ExternalTrace"
  ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

ALTER TABLE "ticket_support"."ExternalTrace"
  ADD COLUMN IF NOT EXISTS "memberIds" TEXT;

CREATE INDEX IF NOT EXISTS "ExternalTrace_platform_conversationId_status_idx"
  ON "ticket_support"."ExternalTrace" ("platform", "conversationId", "status");
