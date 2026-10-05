import { createMiddleware } from "hono/factory";
import { auth } from "./auth.js";
import { config } from "../config.js";
import { resolveMcpIdentity } from "./mcp-auth.js";

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const identity = await resolveMcpIdentity(token, c.req.raw.headers);
    if (identity) {
      if (identity.user) {
        c.set("user", {
          id: identity.user.id,
          role: identity.user.role || (identity.isAdmin ? "admin" : "user"),
        } as any);
      } else if (identity.isAdmin) {
        c.set("user", {
          role: "admin",
        } as any);
      }
      return await next();
    }
  }

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
