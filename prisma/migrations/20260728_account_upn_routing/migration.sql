-- accountUpn for technician routing filters (mailbox that received the message)
ALTER TABLE "ticket_support"."ExternalTrace"
  ADD COLUMN IF NOT EXISTS "accountUpn" TEXT;

ALTER TABLE "ticket_support"."Ticket"
  ADD COLUMN IF NOT EXISTS "accountUpn" TEXT;

CREATE INDEX IF NOT EXISTS "ExternalTrace_accountUpn_status_idx"
  ON "ticket_support"."ExternalTrace" ("accountUpn", "status");

CREATE INDEX IF NOT EXISTS "Ticket_accountUpn_idx"
  ON "ticket_support"."Ticket" ("accountUpn");
