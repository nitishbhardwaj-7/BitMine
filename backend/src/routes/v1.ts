import { Router, type Request } from "express";
import { z } from "zod";
import { requireUser } from "../auth/requireUser.js";
import { startSession } from "../mining/sessions.js";
import { getMiningStatus, listMiners } from "../mining/status.js";
import { createClaimIntent, getClaim } from "../claims/service.js";

const claimBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("regular") }),
  z.object({ kind: z.literal("super"), tier: z.string().min(1).max(40) }),
]);

// requireUser guarantees userId; this narrows the type for handlers.
const uid = (req: Request) => req.userId!;

export function v1Router(opts: { jwtAccessSecret: string }) {
  const r = Router();
  r.use(requireUser(opts.jwtAccessSecret));

  r.get("/mining/status", async (req, res) => {
    res.json(await getMiningStatus(uid(req)));
  });

  r.post("/mining/start", async (req, res) => {
    const s = await startSession(uid(req));
    res.json({ localDate: s!.localDate, startedAt: s!.startedAt.toISOString(), endsAt: s!.endsAt.toISOString() });
  });

  r.get("/miners", async (req, res) => {
    res.json({ miners: await listMiners(uid(req)) });
  });

  r.post("/claims", async (req, res) => {
    const body = claimBody.parse(req.body);
    res.status(201).json(await createClaimIntent(uid(req), body));
  });

  r.get("/claims/:id", async (req, res) => {
    res.json(await getClaim(uid(req), req.params.id!));
  });

  return r;
}
