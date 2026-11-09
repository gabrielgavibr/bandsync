import { updatePreferencesSchema, updateProfileSchema } from "@bandsync/shared";
import { Hono } from "hono";
import {
  findUserById,
  getPreferences,
  toAuthUser,
  toUserDto,
  updatePreferences,
  updateUserProfile,
} from "../db/users";
import type { AppEnv } from "../env";
import { parseBody } from "../lib/validate";
import { requireAuth } from "../middleware/auth";

export const meRoutes = new Hono<AppEnv>();
meRoutes.use("*", requireAuth);

meRoutes.get("/", async (c) => {
  const user = c.get("user");
  return c.json({ user: toUserDto(user), preferences: await getPreferences(c.env.DB, user.id) });
});

meRoutes.patch("/", async (c) => {
  const input = await parseBody(c, updateProfileSchema);
  await updateUserProfile(c.env.DB, c.get("user").id, input);
  const row = await findUserById(c.env.DB, c.get("user").id);
  return c.json({ user: toUserDto(toAuthUser(row!)) });
});

meRoutes.get("/preferences", async (c) =>
  c.json({ preferences: await getPreferences(c.env.DB, c.get("user").id) }),
);

meRoutes.patch("/preferences", async (c) => {
  const input = await parseBody(c, updatePreferencesSchema);
  const prefs = await updatePreferences(c.env.DB, c.get("user").id, input);
  return c.json({ preferences: prefs });
});
