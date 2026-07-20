import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import { REDIS_CLIENT } from "./redis.constants";

/**
 * Best-effort distributed lock (secondary guard only).
 * Postgres `SELECT ... FOR UPDATE SKIP LOCKED` remains the correctness
 * source of truth for lead distribution — this just avoids redundant
 * contention/wasted transactions when the same agent double-clicks or
 * multiple API instances race for the same agent.
 */
@Injectable()
export class RedisLockService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async acquire(key: string, ttlMs = 10_000): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, key, token);
  }

  async withLock<T>(key: string, fn: () => Promise<T>, ttlMs = 10_000): Promise<T> {
    const token = await this.acquire(key, ttlMs);
    if (!token) {
      throw new Error("LOCK_CONTENDED");
    }
    try {
      return await fn();
    } finally {
      await this.release(key, token);
    }
  }
}
