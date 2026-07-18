import { z } from 'zod';

/**
 * Infrastructure configuration, validated at boot — the API refuses to start
 * with an invalid environment. Business-level values do NOT belong here;
 * they live in the Settings module (Configuration over Code, ADR-008).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['debug', 'verbose', 'log', 'warn', 'error']).default('log'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('900s'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default('7d'),

  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(10).optional(),

  // CR-001 Prescription Intelligence Engine (Sprint OCR-01) — infra-level
  // config only; endpoint URLs and business tunables live in Settings.
  PRESCRIPTION_STORAGE_DRIVER: z.enum(['local', 'minio']).default('local'),
  PRESCRIPTION_STORAGE_DIR: z.string().default('./storage/prescriptions'),
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_PORT: z.coerce.number().int().positive().optional(),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET_PRESCRIPTIONS: z.string().default('prescriptions'),
  // z.coerce.boolean() would treat the string "false" as truthy — use an
  // explicit enum+transform instead.
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /// Same-shaped toggle as *_SWEEP_INTERVAL_SECONDS: full-regression runs set
  /// this false so 17 unrelated suites don't each pay for a live BullMQ
  /// worker; the prescriptions e2e suite runs with it enabled.
  PRESCRIPTION_OCR_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
