import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get(key: string) {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    return ttlSeconds ? this.client.set(key, value, 'EX', ttlSeconds) : this.client.set(key, value);
  }

  async del(...keys: string[]) {
    return this.client.del(...keys);
  }

  /** 自增并设置过期（用于限流计数） */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }

  /** SET NX EX：分布式锁，返回 true 表示抢到 */
  async lock(key: string, ttlSeconds: number): Promise<boolean> {
    const ok = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return ok === 'OK';
  }

  async unlock(key: string) {
    await this.client.del(key);
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
