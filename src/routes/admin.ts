import { Hono, type Context } from "hono";
import { AccountStore, hashIdentifier, sameSecret } from "../accounts";
import { JobRepository } from "../db";
import { LEGACY_API_KEY_META } from "../keyStore";
import { httpError, type AppContext } from "./deps";

export const adminRoutes = new Hono<AppContext>();

const ADMIN_CODE_META = "admin_code_hash";

/**
 * Whether an admin code has been chosen yet.
 *
 * Until one is, this deployment is unclaimed and the first caller can set it. That is a deliberate
 * first-run step rather than an open door: it closes permanently the moment a code is set, and the
 * README says to do it immediately after deploying.
 */
async function adminCodeHash(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM app_meta WHERE key = ?`)
    .bind(ADMIN_CODE_META)
    .first<{ value: string }>();
  if (!row) {
    return null;
  }
  try {
    return JSON.parse(row.value) as string;
  } catch {
    return null;
  }
}

/**
 * Checks the admin code on every admin request.
 *
 * The code is sent per request rather than exchanged for a session, so there is no long-lived
 * admin cookie to steal from a browser left open on the page.
 */
async function requireAdmin(c: Context<AppContext>): Promise<void> {
  const expected = await adminCodeHash(c.env.DB);
  if (!expected) {
    throw httpError(409, "No admin code has been set for this deployment yet.");
  }
  const supplied = c.req.header("x-admin-code") ?? "";
  if (!supplied || !sameSecret(await hashIdentifier(supplied), expected)) {
    throw httpError(401, "Wrong admin code.");
  }
}

/** Says whether this deployment still needs claiming, so the page knows which form to show. */
adminRoutes.get("/api/admin/state", async (c) => {
  const claimed = Boolean(await adminCodeHash(c.env.DB));
  const existingKey = claimed
    ? null
    : (await new JobRepository(c.env.DB).getMetaJson<string | null>(LEGACY_API_KEY_META, null))?.trim();
  // Only whether a proof is needed, never any part of the key itself.
  return c.json({ claimed, needs_key_proof: Boolean(existingKey) });
});

/**
 * Claims the deployment by setting the admin code, once.
 *
 * Any ElevenLabs key left over from before accounts existed becomes the first account, and the
 * jobs already in the database are adopted by it, so the history from before this change is not
 * stranded behind a login that nothing owns.
 */
adminRoutes.post("/api/admin/claim", async (c) => {
  if (await adminCodeHash(c.env.DB)) {
    throw httpError(409, "This deployment has already been claimed.");
  }

  const body = await c.req
    .json<{ admin_code?: string; label?: string; key_tail?: string }>()
    .catch(() => ({}) as { admin_code?: string; label?: string; key_tail?: string });
  const code = (body.admin_code ?? "").trim();
  if (code.length < 12) {
    throw httpError(400, "Choose an admin code of at least 12 characters.");
  }

  const existingKey = (
    await new JobRepository(c.env.DB).getMetaJson<string | null>(LEGACY_API_KEY_META, null)
  )?.trim();

  // Proof of ownership, without needing anything set in the dashboard.
  //
  // Between deploying and claiming, this endpoint would otherwise hand whoever found it an access
  // code wired to the existing ElevenLabs key. Whoever owns the deployment knows that key; nobody
  // else does. With no key stored there is nothing yet to take, so nothing to prove.
  if (existingKey) {
    const tail = (body.key_tail ?? "").trim();
    if (!tail || !sameSecret(tail, existingKey.slice(-4))) {
      throw httpError(
        401,
        "Enter the last four characters of the ElevenLabs API key this deployment already holds, " +
          "to show the deployment is yours."
      );
    }
  }

  await c.env.DB.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`)
    .bind(ADMIN_CODE_META, JSON.stringify(await hashIdentifier(code)))
    .run();

  const accounts = new AccountStore(c.env.DB);

  let firstAccount: { identifier: string; label: string; adopted: number } | null = null;
  if (existingKey) {
    const label = (body.label ?? "Owner").trim() || "Owner";
    const created = await accounts.create(label, existingKey);
    const adopted = await accounts.adoptOrphanJobs(created.accountId);
    firstAccount = { identifier: created.identifier, label, adopted };
  }

  return c.json({ claimed: true, first_account: firstAccount });
});

adminRoutes.get("/api/admin/accounts", async (c) => {
  await requireAdmin(c);
  return c.json({ accounts: await new AccountStore(c.env.DB).listWithKeys() });
});

/** Creates an account. The identifier comes back once and is never retrievable again. */
adminRoutes.post("/api/admin/accounts", async (c) => {
  await requireAdmin(c);
  const body = await c.req
    .json<{ label?: string; api_key?: string; reuse_key_from?: string }>()
    .catch(() => ({}) as { label?: string; api_key?: string; reuse_key_from?: string });
  const label = (body.label ?? "").trim();
  if (!label) {
    throw httpError(400, "Give the account a name, so you can tell them apart.");
  }

  const accounts = new AccountStore(c.env.DB);

  // Several people can share one key, drawing on the same credits while keeping their transcripts
  // to themselves. Copying it from an existing account rather than pasting it again avoids the
  // failure that is hardest to spot: a typo makes a second, slightly different key that simply
  // does not work, and nothing about it looks wrong in the list.
  let apiKey = (body.api_key ?? "").trim();
  if (body.reuse_key_from) {
    const shared = await accounts.keyOf(body.reuse_key_from);
    if (!shared) {
      throw httpError(400, "That account has no key to share.");
    }
    apiKey = shared;
  }
  if (!apiKey) {
    throw httpError(400, "Paste an ElevenLabs API key, or choose an account to share one with.");
  }

  const created = await accounts.create(label, apiKey);
  return c.json({
    account_id: created.accountId,
    label,
    identifier: created.identifier,
    note: "Copy this access code now. It is stored only as a hash and cannot be shown again.",
  });
});

/** Replaces a key for every account currently on it, so a shared key rotates in one go. */
adminRoutes.post("/api/admin/keys/:fingerprint", async (c) => {
  await requireAdmin(c);
  const body = await c.req.json<{ api_key?: string }>().catch(() => ({}) as { api_key?: string });
  const apiKey = (body.api_key ?? "").trim();
  if (!apiKey) {
    throw httpError(400, "Paste the replacement ElevenLabs API key.");
  }
  const updated = await new AccountStore(c.env.DB).replaceKeyEverywhere(
    c.req.param("fingerprint"),
    apiKey
  );
  if (!updated) {
    throw httpError(404, "No accounts are using that key.");
  }
  return c.json({ updated });
});

adminRoutes.post("/api/admin/accounts/:id/rotate", async (c) => {
  await requireAdmin(c);
  const accounts = new AccountStore(c.env.DB);
  const account = await accounts.findById(c.req.param("id"));
  if (!account) {
    throw httpError(404, "No such account.");
  }
  return c.json({ identifier: await accounts.rotateIdentifier(account.account_id) });
});

adminRoutes.post("/api/admin/accounts/:id/key", async (c) => {
  await requireAdmin(c);
  const body = await c.req.json<{ api_key?: string }>().catch(() => ({}) as { api_key?: string });
  const apiKey = (body.api_key ?? "").trim();
  if (!apiKey) {
    throw httpError(400, "Paste the replacement ElevenLabs API key.");
  }
  const accounts = new AccountStore(c.env.DB);
  const account = await accounts.findById(c.req.param("id"));
  if (!account) {
    throw httpError(404, "No such account.");
  }
  await accounts.setApiKey(account.account_id, apiKey);
  return c.json({ saved: true });
});

adminRoutes.post("/api/admin/accounts/:id/disabled", async (c) => {
  await requireAdmin(c);
  const body = await c.req.json<{ disabled?: boolean }>().catch(() => ({}) as { disabled?: boolean });
  const accounts = new AccountStore(c.env.DB);
  const account = await accounts.findById(c.req.param("id"));
  if (!account) {
    throw httpError(404, "No such account.");
  }
  await accounts.setDisabled(account.account_id, Boolean(body.disabled));
  return c.json({ disabled: Boolean(body.disabled) });
});
