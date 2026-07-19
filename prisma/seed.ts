import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as crypto from 'crypto';

// SHA256 helper for password hashing
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log("Starting seeding database in production mode (clean database)...");

  // 1. Clean existing data
  await prisma.auditLog.deleteMany({});
  await prisma.externalTrace.deleteMany({});
  await prisma.ticketMessage.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.supportUser.deleteMany({});
  await prisma.systemConfig.deleteMany({});

  console.log("Database cleaned.");

  // 2. Create the production Admin User
  const adminPassword = hashPassword('Caio@2122@');

  const admin = await prisma.supportUser.create({
    data: {
      email: 'caio.correia@groupabz.com',
      passwordHash: adminPassword,
      name: 'Caio Correia',
      role: 'ADMIN',
      microsoftUserId: 'ms-admin-caio',
    }
  });

  console.log("Production Admin User created successfully:", admin.email);

  // 3. Create a default configurations values (Gemini active by default, utilizing env key if present)
  await prisma.systemConfig.create({
    data: {
      key: 'ai_provider',
      value: 'GEMINI'
    }
  });

  console.log("Default system configurations created.");
  console.log("Seeding database complete. Ready for real production data.");

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Error seeding database:", err);
  process.exit(1);
});
