import { UserRole } from "../generated/prisma/enums.ts";
import { hashPassword, isValidPassword } from "../lib/password.ts";
import { getPrisma } from "../lib/prisma.ts";

const name = required("SUPER_ADMIN_NAME");
const email = required("SUPER_ADMIN_EMAIL").toLowerCase();
const password = required("SUPER_ADMIN_PASSWORD");
const prisma = getPrisma();

if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("SUPER_ADMIN_EMAIL is invalid");
if (!isValidPassword(password)) {
  throw new Error("SUPER_ADMIN_PASSWORD must contain 12 to 200 characters");
}

const existing = await prisma.user.findFirst({
  where: { role: UserRole.SUPER_ADMIN },
});

if (existing && existing.email !== email) {
  throw new Error(`A super admin already exists with email ${existing.email}`);
}

const passwordHash = await hashPassword(password);

await prisma.user.upsert({
  where: { email },
  create: { name, email, passwordHash, role: UserRole.SUPER_ADMIN },
  update: { name, passwordHash, active: true },
});

console.log(`Super admin ready: ${email}`);
await prisma.$disconnect();

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
