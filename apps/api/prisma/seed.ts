import { PrismaClient, Prisma } from "@prisma/client";

// Platform catalog seeding requires the migration/admin role. The application
// role is intentionally read-only on "Plan".
const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL },
  },
});

const plans = [
  {
    id: "START",
    name: "Start",
    monthlyPrice: new Prisma.Decimal("490000.00"),
    maxUsers: 5,
    maxVehicles: 25,
    features: {
      uz: ["25 tagacha avtomobil", "5 foydalanuvchi", "Telegram bot", "Audit jurnali"],
      ru: ["До 25 автомобилей", "5 пользователей", "Telegram-бот", "Журнал аудита"],
    },
  },
  {
    id: "PRO",
    name: "Pro",
    monthlyPrice: new Prisma.Decimal("1290000.00"),
    maxUsers: 20,
    maxVehicles: 150,
    features: {
      uz: ["150 tagacha avtomobil", "20 foydalanuvchi", "Shartnoma hujjatlari", "Ustuvor yordam"],
      ru: ["До 150 автомобилей", "20 пользователей", "Документы договоров", "Приоритетная поддержка"],
    },
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    monthlyPrice: new Prisma.Decimal("3490000.00"),
    maxUsers: 100,
    maxVehicles: 2000,
    features: {
      uz: ["2000 tagacha avtomobil", "100 foydalanuvchi", "Individual tariflar", "API integratsiya"],
      ru: ["До 2000 автомобилей", "100 пользователей", "Индивидуальные тарифы", "API-интеграция"],
    },
  },
];

async function main() {
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      create: plan,
      update: {
        name: plan.name,
        monthlyPrice: plan.monthlyPrice,
        maxUsers: plan.maxUsers,
        maxVehicles: plan.maxVehicles,
        features: plan.features,
        isActive: true,
      },
    });
  }
  console.log(`Seeded ${plans.length} subscription plans`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
