import 'dotenv/config';
import { prisma } from './lib/prisma.js';

async function main() {
  // Example query to verify the connection. Replace with domain specific logic.
  await prisma.$connect();
  console.log('Prisma connection established.');
}

main()
  .catch((error) => {
    console.error('Failed to run Prisma bootstrap script:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
