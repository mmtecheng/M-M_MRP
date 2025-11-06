import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Add seed data here. This file is executed with `npm run prisma:generate` automatically
  // when `npx prisma db seed` is invoked. Use it to populate lookup tables or
  // create starter records required by the application.
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
