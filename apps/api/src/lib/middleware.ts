import { createMiddleware } from "hono/factory";
import { auth } from "./auth.js";
import { config } from "../config.js";

export const authMiddleware = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    if (config.publicMode) {
      return await next();
    }
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

export const adminMiddleware = createMiddleware(async (c, next) => {
  const user = c.get("user") as any;

  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
});
