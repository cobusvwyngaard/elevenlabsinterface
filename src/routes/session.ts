import { Hono } from "hono";
import {
  AccountStore,
  clearedCookie,
  isSecureRequest,
  normaliseIdentifier,
  sessionCookie,
} from "../accounts";
import { maskKey } from "../keyStore";
import { currentAccount, httpError, type AppContext } from "./deps";

export const sessionRoutes = new Hono<AppContext>();

/** Who is signed in, if anyone. The page asks this before deciding what to show. */
sessionRoutes.get("/api/session", async (c) => {
  const account = await currentAccount(c);
  if (!account) {
    return c.json({ signed_in: false });
  }
  return c.json({
    signed_in: true,
    label: account.label,
    api_key_saved: Boolean(account.api_key?.trim()),
    api_key_masked: account.api_key?.trim() ? maskKey(account.api_key) : null,
  });
});

/**
 * Exchanges an identifier for a session cookie.
 *
 * The identifier is the credential, so the same refusal is returned whether it is unknown or
 * disabled: distinguishing the two would confirm which codes exist to anyone guessing.
 */
sessionRoutes.post("/api/session", async (c) => {
  const body = await c.req.json<{ identifier?: string }>().catch(() => ({}) as { identifier?: string });
  const identifier = normaliseIdentifier(body.identifier ?? "");
  if (!identifier) {
    throw httpError(400, "Enter your access code.");
  }

  const accounts = new AccountStore(c.env.DB);
  const account = await accounts.findByIdentifier(identifier);
  if (!account) {
    throw httpError(401, "That access code was not recognised.");
  }

  await accounts.touch(account.account_id);
  c.header("set-cookie", sessionCookie(identifier, isSecureRequest(c.env, c.req.url)));
  return c.json({
    signed_in: true,
    label: account.label,
    api_key_saved: Boolean(account.api_key?.trim()),
    api_key_masked: account.api_key?.trim() ? maskKey(account.api_key) : null,
  });
});

sessionRoutes.delete("/api/session", async (c) => {
  c.header("set-cookie", clearedCookie(isSecureRequest(c.env, c.req.url)));
  return c.json({ signed_in: false });
});
