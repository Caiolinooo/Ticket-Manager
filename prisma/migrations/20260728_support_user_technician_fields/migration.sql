-- Technician config on SupportUser (role TECHNICIAN + mailbox/Teams scope)
ALTER TABLE "ticket_support"."SupportUser"
  ADD COLUMN IF NOT EXISTS "monitoredEmails" TEXT,
  ADD COLUMN IF NOT EXISTS "monitoredTeamsAccounts" TEXT,
  ADD COLUMN IF NOT EXISTS "receiveMode" TEXT,
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
