import { z } from 'zod';
import { assertNewWrite } from '../http/write-gate.ts';
import { requireAdmin, requireRecentAdminAuth, requireSession, requireSessionCsrf, revalidateAtCommit } from '../auth/authorization.ts';
import { deleteUserSessions } from '../auth/sessions.ts';
import { hmacHex } from '../auth/keys.ts';
import { writeTransaction } from '../database/transaction.ts';
import { decodeCursor, encodeCursor } from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { parseQuery } from '../http/query.ts';
import { likePattern } from '../http/search.ts';
import { readJsonBody } from '../http/request-body.ts';
import { sendJson } from '../http/response.ts';
import type { RequestContext } from '../http/router.ts';
import { merchantProfileSchema, normalizePhone } from '../../shared/schemas.ts';
import { writeAudit } from './audit.ts';

/**
 * Merchant lifecycle (stage 05): self-service profile and administrator
 * review/approval. Identity always comes from the session; IDs in bodies,
 * queries or headers never select whose profile is read or changed.
 */

const BODY_LIMIT = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;

export type MerchantStatus = 'pending' | 'approved' | 'suspended';

interface MerchantRow {
  id: string;
  user_id: string;
  business_name: string;
  contact_name: string;
  email: string | null;
  phone: string;
  governorate: string;
  address: string;
  status: MerchantStatus;
  version: number;
  access_version: number;
  status_changed_at: number | null;
  created_at: number;
  updated_at: number;
  username: string;
  role: 'admin' | 'trader';
}

const SELECT_MERCHANT = `SELECT m.id, m.user_id, m.business_name, m.contact_name, m.email, m.phone, m.governorate, m.address, m.status,
                                m.version, m.access_version, m.status_changed_at, m.created_at, m.updated_at, u.username, u.role
                           FROM merchants m JOIN auth_users u ON u.id = m.user_id`;

function ownProfile(m: MerchantRow) {
  return {
    id: m.id,
    status: m.status,
    businessName: m.business_name,
    contactName: m.contact_name,
    email: m.email,
    phone: m.phone,
    governorate: m.governorate,
    address: m.address,
    version: m.version,
    updatedAt: m.updated_at,
  };
}

/** Administrator view: contact details plus account identity — never credentials or session data. */
function adminView(m: MerchantRow) {
  return {
    ...ownProfile(m),
    username: m.username,
    role: m.role,
    createdAt: m.created_at,
    statusChangedAt: m.status_changed_at,
  };
}

function validationError(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): AppError {
  return new AppError('VALIDATION_FAILED', {
    fields: issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.') || '(body)', message: ARABIC.test(i.message) ? i.message : 'قيمة غير صالحة أو حقل غير مسموح به.' })),
  });
}

async function parseBody<T>(ctx: RequestContext, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readJsonBody(ctx.req, BODY_LIMIT));
  if (!parsed.success) throw validationError(parsed.error.issues);
  return parsed.data;
}

const expectedVersion = z.number({ error: 'رقم الإصدار المتوقع مطلوب.' }).int().min(1).max(2_147_483_647);

// ------------------------------------------------------------------ self-service profile

/** Editable by the owner. Status, role, ids, credentials and MFA are not part of this schema (strict → rejected). */
const optionalEmail = z
  .union([
    z.null(),
    z
      .string()
      .max(254)
      .transform((s) => s.trim().toLowerCase())
      .pipe(z.union([z.literal(''), z.email('البريد الإلكتروني غير صحيح')]))
      .transform((s) => (s === '' ? null : s)),
  ])
  .optional();

const profilePatchSchema = z
  .strictObject({
    expectedVersion,
    businessName: merchantProfileSchema.shape.businessName.optional(),
    contactName: merchantProfileSchema.shape.contactName.optional(),
    email: optionalEmail,
    phone: merchantProfileSchema.shape.phone.optional(),
    governorate: merchantProfileSchema.shape.governorate.optional(),
    address: merchantProfileSchema.shape.address.optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedVersion'), { message: 'لا توجد حقول للتعديل.' });

/** Fixed field → column map: column names never come from the request. */
const PROFILE_COLUMNS = {
  businessName: 'business_name',
  contactName: 'contact_name',
  email: 'email',
  phone: 'phone',
  governorate: 'governorate',
  address: 'address',
} as const;

export function getOwnProfile(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  // No parameters are accepted: the merchant is never selected by the request.
  parseQuery(ctx.query, z.strictObject({}));
  const m = ctx.services.db.prepare(`${SELECT_MERCHANT} WHERE m.id = ?`).get(auth.identity.merchantId) as unknown as MerchantRow;
  sendJson(ctx.res, 200, { profile: ownProfile(m) });
}

export async function patchOwnProfile(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  const body = await parseBody(ctx, profilePatchSchema);
  const { db, now } = ctx.services;

  const updated = writeTransaction(db, () => {
    // The session may have been revoked (suspension, logout, password change) while the body was read.
    const identity = revalidateAtCommit(ctx, auth);
    assertNewWrite(ctx);
    const current = db.prepare(`${SELECT_MERCHANT} WHERE m.id = ?`).get(identity.merchantId) as unknown as MerchantRow;
    if (current.version !== body.expectedVersion) throw new AppError('VERSION_CONFLICT', { current: { profile: ownProfile(current) } });

    const fields = (Object.keys(PROFILE_COLUMNS) as Array<keyof typeof PROFILE_COLUMNS>).filter((k) => body[k] !== undefined);
    const t = now();
    const assignments = fields.map((k) => `${PROFILE_COLUMNS[k]} = ?`).join(', ');
    const values = fields.map((k) => body[k] as string | null);
    // Status and access_version are deliberately absent: a profile edit never approves, unsuspends or promotes.
    const result = db
      .prepare(`UPDATE merchants SET ${assignments}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
      .run(...values, Math.max(t, current.updated_at), current.id, body.expectedVersion); // client's version: independent second check
    if (result.changes !== 1) throw new AppError('VERSION_CONFLICT', { current: { profile: ownProfile(current) } });
    writeAudit(db, {
      actorUserId: identity.userId,
      action: 'merchant.profile_updated',
      targetType: 'merchant',
      targetId: current.id,
      metadata: { fields: fields.join(','), version: current.version + 1 },
      ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp),
      requestId: ctx.requestId,
      now: t,
    });
    return db.prepare(`${SELECT_MERCHANT} WHERE m.id = ?`).get(current.id) as unknown as MerchantRow;
  });
  sendJson(ctx.res, 200, { profile: ownProfile(updated) });
}

// ------------------------------------------------------------------ administrator: list and detail

const SORTS = {
  newest: { order: 'm.created_at DESC, m.id DESC', after: '(m.created_at, m.id) < (?, ?)', key: (m: MerchantRow) => [m.created_at, m.id] },
  oldest: { order: 'm.created_at ASC, m.id ASC', after: '(m.created_at, m.id) > (?, ?)', key: (m: MerchantRow) => [m.created_at, m.id] },
  name: { order: 'm.business_name COLLATE NOCASE ASC, m.id ASC', after: '(m.business_name COLLATE NOCASE, m.id) > (?, ?)', key: (m: MerchantRow) => [m.business_name, m.id] },
} as const;

const listQuerySchema = z.strictObject({
  status: z.enum(['pending', 'approved', 'suspended']).optional(),
  q: z
    .string()
    .transform((s) => s.normalize('NFKC').trim())
    .pipe(z.string().min(1, 'نص البحث فارغ.').max(80, 'نص البحث أطول من 80 حرفًا.'))
    .optional(),
  sort: z.enum(['newest', 'oldest', 'name']).optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  cursor: z.string().max(2048).optional(),
});


export function listMerchants(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  const query = parseQuery(ctx.query, listQuerySchema);
  const sortName = query.sort ?? 'newest';
  const sort = SORTS[sortName];
  const limit = query.limit ?? 25;
  // Cursor scope binds it to this endpoint, sort and filters (and, via the MAC, to this admin).
  const scope = `admin.merchants\0${sortName}\0${query.status ?? ''}\0${query.q ?? ''}`;

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query.status) {
    where.push('m.status = ?');
    params.push(query.status);
  }
  if (query.q) {
    const p = likePattern(query.q);
    const phone = likePattern(normalizePhone(query.q));
    where.push("(m.business_name LIKE ? ESCAPE '\\' OR m.contact_name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR m.email LIKE ? ESCAPE '\\' OR m.phone LIKE ? ESCAPE '\\')");
    params.push(p, p, p, p, phone);
  }
  if (query.cursor) {
    const position = decodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, query.cursor);
    const [k, id] = position;
    if (position.length !== 2 || !(typeof k === 'number' || typeof k === 'string') || typeof id !== 'string' || !UUID.test(id)) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'cursor', message: 'مؤشر الصفحة غير صالح.' }] });
    }
    where.push(sort.after);
    params.push(k, id);
  }
  const sql = `${SELECT_MERCHANT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sort.order} LIMIT ?`;
  const rows = ctx.services.db.prepare(sql).all(...params, limit + 1) as unknown as MerchantRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  sendJson(ctx.res, 200, {
    items: page.map(adminView),
    nextCursor: rows.length > limit && last ? encodeCursor(ctx.services.keys.cursor, scope, auth.identity.userId, sort.key(last)) : null,
  });
}

function loadMerchant(ctx: RequestContext, id: string | undefined): MerchantRow {
  if (!id || !UUID.test(id)) throw new AppError('NOT_FOUND');
  const m = ctx.services.db.prepare(`${SELECT_MERCHANT} WHERE m.id = ?`).get(id) as unknown as MerchantRow | undefined;
  if (!m) throw new AppError('NOT_FOUND');
  return m;
}

export function getMerchant(ctx: RequestContext): void {
  const auth = requireSession(ctx);
  requireAdmin(auth);
  const m = loadMerchant(ctx, ctx.params.id);
  const history = ctx.services.db
    .prepare(
      `SELECT a.metadata, a.created_at, u.username AS actor
         FROM audit_logs a LEFT JOIN auth_users u ON u.id = a.actor_user_id
        WHERE a.action = 'merchant.status_changed' AND a.target_type = 'merchant' AND a.target_id = ?
        ORDER BY a.id DESC LIMIT 20`,
    )
    .all(m.id) as Array<{ metadata: string | null; created_at: number; actor: string | null }>;
  sendJson(ctx.res, 200, {
    merchant: adminView(m),
    statusHistory: history.map((h) => {
      const meta = (h.metadata ? JSON.parse(h.metadata) : {}) as { from?: string; to?: string; reason?: string };
      return { from: meta.from ?? null, to: meta.to ?? null, reason: meta.reason ?? null, at: h.created_at, actor: h.actor };
    }),
  });
}

// ------------------------------------------------------------------ administrator: state changes

/**
 * Allowed transitions (all others, including "no change", are refused):
 *   pending  -> approved            reason optional            access granted (no session created)
 *   pending  -> suspended           reason required            sessions revoked
 *   approved -> suspended           reason required            sessions revoked
 *   approved -> pending             reason required            sessions revoked (access removed)
 *   suspended -> approved | pending reason required            (no sessions exist)
 */
const TRANSITIONS: Record<MerchantStatus, Partial<Record<MerchantStatus, { reasonRequired: boolean }>>> = {
  pending: { approved: { reasonRequired: false }, suspended: { reasonRequired: true } },
  approved: { suspended: { reasonRequired: true }, pending: { reasonRequired: true } },
  suspended: { approved: { reasonRequired: true }, pending: { reasonRequired: true } },
};

export function removesAccess(from: MerchantStatus, to: MerchantStatus): boolean {
  return to === 'suspended' || (from === 'approved' && to === 'pending');
}

const statusPatchSchema = z.strictObject({
  status: z.enum(['pending', 'approved', 'suspended']),
  expectedVersion,
  reason: z
    .string()
    .max(800)
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(3, 'السبب من 3 إلى 200 حرف.').max(200, 'السبب من 3 إلى 200 حرف.'))
    .optional(),
});

export async function changeMerchantStatus(ctx: RequestContext): Promise<void> {
  const auth = requireSession(ctx);
  requireSessionCsrf(ctx, auth);
  requireRecentAdminAuth(ctx, auth);
  const id = ctx.params.id;
  if (!id || !UUID.test(id)) throw new AppError('NOT_FOUND');
  const body = await parseBody(ctx, statusPatchSchema);
  const { db, now } = ctx.services;

  const result = writeTransaction(db, () => {
    // Re-check the administrator at the committing boundary (session, role, recent authentication).
    const actor = revalidateAtCommit(ctx, auth, { admin: 'recent' });
    assertNewWrite(ctx);
    const target = db.prepare(`${SELECT_MERCHANT} WHERE m.id = ?`).get(id) as unknown as MerchantRow | undefined;
    if (!target) throw new AppError('NOT_FOUND');
    if (target.role === 'admin') throw new AppError('ADMIN_ACCOUNT_PROTECTED');
    const current = { status: target.status, version: target.version };
    if (target.version !== body.expectedVersion) throw new AppError('VERSION_CONFLICT', { current });
    const rule = TRANSITIONS[target.status][body.status];
    if (!rule) throw new AppError('INVALID_STATE_TRANSITION', { current });
    if (rule.reasonRequired && !body.reason) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'reason', message: 'يجب ذكر سبب لهذا التغيير.' }] });
    }
    const t = Math.max(now(), target.updated_at);
    const updated = db
      .prepare('UPDATE merchants SET status = ?, access_version = access_version + 1, version = version + 1, status_changed_at = ?, updated_at = ? WHERE id = ? AND version = ?')
      .run(body.status, t, t, target.id, body.expectedVersion); // client's version: independent second check
    if (updated.changes !== 1) throw new AppError('VERSION_CONFLICT', { current });
    const revoked = removesAccess(target.status, body.status) ? deleteUserSessions(db, target.user_id) : 0;
    writeAudit(db, {
      actorUserId: actor.userId,
      action: 'merchant.status_changed',
      targetType: 'merchant',
      targetId: target.id,
      metadata: { from: target.status, to: body.status, ...(body.reason ? { reason: body.reason } : {}), sessions_revoked: revoked, version: target.version + 1 },
      ipHmac: hmacHex(ctx.services.keys.ip, ctx.clientIp),
      requestId: ctx.requestId,
      now: t,
    });
    return { merchant: db.prepare(`${SELECT_MERCHANT} WHERE m.id = ?`).get(target.id) as unknown as MerchantRow, revoked };
  });
  // Approval creates no session and sends no notification (none is configured).
  sendJson(ctx.res, 200, { merchant: adminView(result.merchant), sessionsRevoked: result.revoked });
}
