-- Link SupportUser technicians to Portal (EmployeeHub) users_unified
ALTER TABLE "ticket_support"."SupportUser"
  ADD COLUMN IF NOT EXISTS "portalUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "authSource" TEXT;
