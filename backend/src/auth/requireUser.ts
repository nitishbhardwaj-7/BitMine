import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { User } from "../models/index.js";
import { AppError } from "../lib/errors.js";
import { verifyAccessToken } from "./tokens.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by requireUser: the only user this request may act as. */
    userId?: Types.ObjectId;
  }
}

export function requireUser(secret: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.get("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      const sub = token ? await verifyAccessToken(token, secret) : null;
      if (!sub) throw new AppError(401, "unauthorized", "Please sign in again.");

      const user = await User.findById(sub).select({ status: 1 }).lean();
      if (!user || user.status !== "active") throw new AppError(401, "unauthorized", "Please sign in again.");

      req.userId = new Types.ObjectId(sub);
      next();
    } catch (err) {
      next(err);
    }
  };
}
