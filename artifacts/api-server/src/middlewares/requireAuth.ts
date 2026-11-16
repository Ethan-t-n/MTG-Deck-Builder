import { getAuth } from "@clerk/express";
import type { RequestHandler, Request } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to access saved decks." });
    return;
  }

  res.locals.userId = userId;
  next();
};

export function getRequestUserId(req: Request): string {
  const userId = getAuth(req).userId;
  if (!userId) {
    throw new Error("Authenticated user ID is missing.");
  }
  return userId;
}
