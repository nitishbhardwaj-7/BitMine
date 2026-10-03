/**
 * Mini-games (Block Miner, Hash Match).
 *
 *   1. POST /v1/games/rounds            → a round starts (today's mining must be on)
 *   2. POST /v1/games/rounds/:id/finish → the app reports won or lost
 *   3. won  → a rewarded video (claim kind "game") turns the round into hashpower until midnight
 *      lost → the games are locked until a rewarded video (claim kind "retry") is watched
 *
 * The games run on the phone, so a win is the app's word. That is why the
 * reward is small, needs an AdMob-confirmed video, and is capped per day
 * (settings/growth.ts: gameWinsPerDay, gameGh). The server only checks that a
 * round could plausibly have been played in the time it took.
 */
import { Types } from "mongoose";
import { GameRound, Session } from "../models/index.js";
import { AppError, notFound } from "../lib/errors.js";
import { claimCount, currentSession, sessionActive } from "../mining/sessions.js";
import { getGrowth } from "../settings/growth.js";

export const GAME_TRACK = "game";
/** The quickest a round can honestly be won, and how long a round stays open. */
export const GAMES = {
  block: { name: "Block Miner", minWinMs: 2_000 },
  match: { name: "Hash Match", minWinMs: 6_000 },
} as const;
export type GameId = keyof typeof GAMES;
const ROUND_OPEN_MS = 10 * 60_000;
const MAX_ROUNDS_PER_DAY = 300;

export async function startRound(userId: Types.ObjectId, game: GameId, now = Date.now()) {
  const g = await getGrowth();
  if (g.gameWinsPerDay <= 0) throw notFound("Games");
  const session = await currentSession(userId, now);
  if (!sessionActive(session, now)) throw new AppError(409, "session_not_started", "Start today's mining first.");
  if (session!.gameLock) throw new AppError(409, "retry_required", "Watch a video to try again.");
  if (claimCount(session, GAME_TRACK) >= g.gameWinsPerDay) {
    throw new AppError(409, "daily_limit_reached", "You've claimed all of today's game rewards. Come back after midnight.", { cap: g.gameWinsPerDay });
  }
  if ((await GameRound.countDocuments({ userId, localDate: session!.localDate })) >= MAX_ROUNDS_PER_DAY) {
    throw new AppError(429, "too_many_rounds", "That's enough games for today. Come back tomorrow.");
  }
  const round = await GameRound.create({ userId, game, localDate: session!.localDate, startedAt: new Date(now) });
  return { roundId: String(round._id), game, rewardGh: g.gameGh };
}

export async function finishRound(userId: Types.ObjectId, roundId: string, won: boolean, now = Date.now()) {
  if (!Types.ObjectId.isValid(roundId)) throw notFound("Round");
  const round = await GameRound.findOne({ _id: roundId, userId }).lean();
  if (!round) throw notFound("Round");
  if (round.status !== "playing") return { roundId, status: round.status };

  const elapsed = now - round.startedAt.getTime();
  if (won && elapsed < GAMES[round.game as GameId].minWinMs) throw new AppError(400, "invalid_result", "That round couldn't be confirmed.");
  // A round left open too long counts as lost, whatever the app says.
  const status = won && elapsed <= ROUND_OPEN_MS ? "won" : "lost";
  const changed = await GameRound.updateOne({ _id: round._id, status: "playing" }, { $set: { status, finishedAt: new Date(now) } });
  if (changed.modifiedCount !== 1) return { roundId, status: (await GameRound.findById(round._id).lean())!.status };
  if (status === "lost") await Session.updateOne({ userId, localDate: round.localDate }, { $set: { gameLock: true } });
  return { roundId, status };
}

/** What the app shows on the game tiles. */
export async function gamesView(session: { claimCounts?: unknown; gameLock?: boolean | null } | null) {
  const g = await getGrowth();
  if (g.gameWinsPerDay <= 0) return null;
  return { used: claimCount(session, GAME_TRACK), cap: g.gameWinsPerDay, gh: g.gameGh, locked: Boolean(session?.gameLock) };
}
