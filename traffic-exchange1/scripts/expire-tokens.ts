// Background maintenance job: mark stale PENDING visits as EXPIRED so the queue
// and duplicate-token checks stay accurate. Run on a schedule, e.g. cron:
//   */5 * * * *  docker compose run --rm app npx tsx scripts/expire-tokens.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const res = await prisma.visit.updateMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  console.log(`Expired ${res.count} stale visit token(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
