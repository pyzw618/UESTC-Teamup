import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';

export interface ViewerInfo {
  userId?: string;
  role: string;
  /** 当前用户所在全部队伍（一次性查出，防半匿名序列化 N+1） */
  teamIds: Set<string>;
}

/**
 * 请求级 viewer 上下文：半匿名序列化时判断"是否同队"用，
 * 避免列表页对每个用户重复查库（MODULE_MATCH §4 性能坑）
 */
@Injectable()
export class ViewerContext {
  private readonly als = new AsyncLocalStorage<ViewerInfo>();

  run<T>(info: ViewerInfo, fn: () => T): T {
    return this.als.run(info, fn);
  }

  get(): ViewerInfo {
    return this.als.getStore() ?? { role: 'STUDENT', teamIds: new Set() };
  }
}

export type SerializableUser = Pick<
  User,
  'id' | 'nickname' | 'college' | 'grade' | 'major' | 'studentNo' | 'bio'
> & {
  // 只要求序列化真正用到的字段（user 关系通常只 select skill/level）
  skills?: { skill: string; level: number | null }[];
  /** 该用户参与的队伍 id（调用方 include，供同队判断） */
  teamIds?: string[];
  /** 该用户的联系方式（同队/本人/管理员可见） */
  contact?: string | null;
};

export interface SerializedUser {
  id: string;
  nickname: string | null;
  college: string | null;
  grade: number | null;
  major: string | null;
  bio: string | null;
  skills: { skill: string; level: number | null }[];
  studentNo?: string;
  contact?: string | null;
}

/**
 * 半匿名序列化（PAGES.md §5 全局约束，在服务端裁剪，不能只靠前端隐藏）
 * 陌生人：昵称/学院/年级/专业/技能
 * 同队 / 本人 / 管理员：额外解锁学号与联系方式
 */
@Injectable()
export class UserSerializer {
  constructor(private readonly viewer: ViewerContext) {}

  serialize(user: SerializableUser): SerializedUser {
    const v = this.viewer.get();
    const base: SerializedUser = {
      id: user.id,
      nickname: user.nickname,
      college: user.college,
      grade: user.grade,
      major: user.major,
      bio: user.bio ?? null,
      skills: (user.skills ?? []).map((s) => ({ skill: s.skill, level: s.level })),
    };

    const sameTeam =
      Array.isArray(user.teamIds) && v.teamIds.size > 0 && user.teamIds.some((tid) => v.teamIds.has(tid));
    const canSeePrivate = user.id === v.userId || v.role === 'ADMIN' || sameTeam;

    return canSeePrivate ? { ...base, studentNo: user.studentNo, contact: user.contact ?? null } : base;
  }

  serializeMany(users: SerializableUser[]): SerializedUser[] {
    return users.map((u) => this.serialize(u));
  }
}
