import { Types } from "mongoose";
import { Product, SuperEntitlement, User } from "../models/index.js";

let n = 0;

export async function createUser(timezone = "Asia/Kolkata") {
  n++;
  const user = await User.create({
    email: `user${n}-${Date.now()}@example.com`,
    name: `Test User ${n}`,
    timezone,
    referralCode: `REF${n}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    emailVerified: true,
  });
  return user._id as Types.ObjectId;
}

export async function grantSuperTier(userId: Types.ObjectId, sku: string, until: number) {
  const product = await Product.findOne({ sku }).lean();
  if (!product) throw new Error(`no product ${sku}`);
  await SuperEntitlement.create({ userId, productId: product._id, activeUntil: new Date(until) });
  return product;
}
