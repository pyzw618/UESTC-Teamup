import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { RedisService } from '../redis.service';
import { PrismaService } from '../prisma.service';
import type { User } from '@prisma/client';

export const SESSION_COOKIE = 'teamup_sid';

export interface SessionData {
  userId: string;
  createdAt: number;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private ttlHours() {
    return Number(process.env.SESSION_TTL_HOURS ?? 168);
  }

  async create(userId: string): Promise<string> {
    const sid = randomBytes(24).toString('hex');
    const data: SessionData = { userId, createdAt: Date.now() };
    await this.redis.set(this.key(sid), JSON.stringify(data), this.ttlHours() * 3600);
    return sid;
  }

  async resolve(sid: string | undefined): Promise<User | null> {
    if (!sid) return null;
    const raw = await this.redis.get(this.key(sid));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as SessionData;
      const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
      if (!user || user.banned) return null;
      return user;
    } catch {
      return null;
    }
  }

  /** 强制下线（封禁用） */
  async destroyByUserId(userId: string) {
    // Session 无索引，量级小，scan 即可
    const stream = this.redis.client.scanStream({ match: 'session:*', count: 100 });
    for await (const keys of stream) {
      const list = keys as string[];
      for (const k of list) {
        const raw = await this.redis.get(k);
        if (raw && (JSON.parse(raw) as SessionData).userId === userId) await this.redis.del(k);
      }
    }
  }

  async destroy(sid: string) {
    await this.redis.del(this.key(sid));
  }

  private key(sid: string) {
    return `session:${sid}`;
  }
}

/** 读取当前请求的会话用户；未登录返回 null */
export async function getRequestUser(req: Request, sessions: SessionService): Promise<User | null> {
  return sessions.resolve((req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE]);
}

export function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: Number(process.env.SESSION_TTL_HOURS ?? 168) * 3600 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}
