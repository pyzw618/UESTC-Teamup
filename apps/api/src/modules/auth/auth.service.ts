import { randomInt } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../common/prisma.service';
import { SessionService } from '../../common/auth/session.service';
import { MailService } from '../mail/mail.module';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../../common/password';

/** 校园邮箱白名单与格式（Q11：放宽为 8–16 位数字，兼容研究生等） */
export const CAMPUS_EMAIL_RE = /^\d{8,16}@std\.uestc\.edu\.cn$/;

const CODE_TTL = 300; // 5 分钟
const RESEND_COOLDOWN = 60;
const DAILY_PER_EMAIL = 5;
const DAILY_PER_IP = 20;
const GLOBAL_PER_MINUTE = 10;
const MAX_FAILS = 5;
/** 密码登录失败计数 / 锁定的窗口（15 分钟） */
const LOGIN_FAIL_TTL = 900;
/** 密码登录允许的连续失败次数，达到后锁定 */
const LOGIN_MAX_FAILS = 5;

/** 登录验证码 */
const VERIFY_PREFIX = 'verify:code:';
/** 找回密码验证码（与登录码隔离） */
const RESET_PREFIX = 'pwdreset:code:';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * 发送验证码（登录 / 首次注册）。限流矩阵与 Redis Key 见 MODULE_AUTH §2/§6。
   * 无论邮箱是否已注册，响应一致（防邮箱枚举）。
   */
  async sendCode(email: string, ip: string): Promise<{ devCode?: string }> {
    const { devCode } = await this.sendEmailCode(email, ip, VERIFY_PREFIX, 'UESTC TeamUp 登录验证码', '用于登录 UESTC TeamUp');
    return devCode ? { devCode } : {};
  }

  /** 忘记密码：发送找回验证码 */
  async sendResetCode(email: string, ip: string): Promise<{ devCode?: string }> {
    const { devCode } = await this.sendEmailCode(
      email,
      ip,
      RESET_PREFIX,
      'UESTC TeamUp 密码找回验证码',
      '用于重置你的 UESTC TeamUp 密码。若非本人操作请忽略。',
    );
    return devCode ? { devCode } : {};
  }

  private async sendEmailCode(email: string, ip: string, prefix: string, subject: string, purpose: string) {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');

    const isReset = prefix === RESET_PREFIX;

    // 60s 重发冷却
    const cooldownKey = isReset ? `pwdreset:cooldown:${email}` : `verify:cooldown:${email}`;
    const cooldown = await this.redis.lock(cooldownKey, RESEND_COOLDOWN);
    if (!cooldown) {
      // H6：冷却期内静默返回与成功完全一致的形状（不重发、不覆写已有验证码），
      // 避免攻击者替受害者反复发码从而锁死其登录。
      return {};
    }

    const day = this.today();
    // 配额 key 按流程隔离：找回密码与登录各自独立，避免 NAT 下互相拖累
    const emailQuotaKey = isReset ? `reset:quota:${email}:${day}` : `${prefix}quota:${email}:${day}`;
    const ipQuotaKey = isReset ? `reset:quota:ip:${ip}:${day}` : `verify:quota:ip:${ip}:${day}`;

    // 同邮箱每日上限
    const emailCount = await this.redis.incrWithTtl(emailQuotaKey, 86400);
    if (emailCount > DAILY_PER_EMAIL) throw new BadRequestException('该邮箱今日发送次数已达上限');
    // 同 IP 每日上限
    const ipCount = await this.redis.incrWithTtl(ipQuotaKey, 86400);
    if (ipCount > DAILY_PER_IP) throw new BadRequestException('当前网络发送次数已达上限，请明日再试');
    // 全局每分钟上限（保护邮件额度）
    const minuteBucket = `${month6(day)}${this.currentMinute()}`;
    const globalCount = await this.redis.incrWithTtl(`verify:quota:global:${minuteBucket}`, 120);
    if (globalCount > GLOBAL_PER_MINUTE) throw new BadRequestException('当前发送人数较多，请稍后再试');

    const code = String(randomInt(100000, 1000000));
    await this.redis.set(`${prefix}${email}`, code, CODE_TTL);
    await this.redis.del(`${prefix}fail:${email}`);

    try {
      await this.mail.send({
        to: email,
        subject,
        html: `<p>${purpose}，验证码是 <b>${code}</b>，5 分钟内有效。</p>`,
        text: `${purpose}，验证码是 ${code}，5 分钟内有效。`,
      });
    } catch (err) {
      // S4c：发信失败必须回滚，否则冷却锁与已占配额会把用户"锁死"在失败态
      await this.redis.del(cooldownKey);
      await this.redis.client.decr(emailQuotaKey);
      await this.redis.client.decr(ipQuotaKey);
      this.logger.error(`验证码邮件发送失败: ${email} (${prefix}) ${(err as Error)?.message ?? String(err)}`);
      throw new BadRequestException('邮件发送失败，请稍后重试');
    }

    this.logger.log(`验证码已发送至 ${email} (${prefix})`);
    return { devCode: process.env.NODE_ENV !== 'production' ? code : undefined };
  }

  private async consumeCode(email: string, code: string, prefix: string) {
    const saved = await this.redis.get(`${prefix}${email}`);
    if (!saved) throw new BadRequestException('验证码已过期，请重新发送');

    if (saved !== code.trim()) {
      const fails = await this.redis.incrWithTtl(`${prefix}fail:${email}`, CODE_TTL);
      if (fails >= MAX_FAILS) {
        await this.redis.del(`${prefix}${email}`, `${prefix}fail:${email}`);
        throw new BadRequestException('错误次数过多，该验证码已作废，请重新发送');
      }
      throw new BadRequestException(`验证码错误（还剩 ${MAX_FAILS - fails} 次机会）`);
    }
    await this.redis.del(`${prefix}${email}`, `${prefix}fail:${email}`);
  }

  /**
   * 验证码登录（登录即注册）。返回 isNew 与 hasPassword 供前端引导。
   */
  async loginWithCode(email: string, code: string, ip: string) {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');
    void ip;

    await this.consumeCode(email, code, VERIFY_PREFIX);

    const studentNo = email.split('@')[0];
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.banned) throw new BadRequestException('该账号已被封禁，如有疑问请联系管理员');
      return { user: existing, isNew: false };
    }

    const parsed = parseStudentNo(studentNo);
    const user = await this.prisma.user.create({
      data: {
        email,
        studentNo,
        grade: parsed.grade,
        college: parsed.college,
        nickname: null,
      },
    });
    return { user, isNew: true };
  }

  /** 密码登录。错误信息统一，不区分邮箱/密码（防枚举）；连续失败会触发 15 分钟锁定（防爆破） */
  async loginWithPassword(email: string, password: string) {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');

    const failKey = `login:fail:${email}`;
    const lockKey = `login:lock:${email}`;
    if (await this.redis.get(lockKey)) throw new BadRequestException('尝试次数过多，请 15 分钟后再试');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      const fails = await this.redis.incrWithTtl(failKey, LOGIN_FAIL_TTL);
      if (fails >= LOGIN_MAX_FAILS) await this.redis.set(lockKey, '1', LOGIN_FAIL_TTL);
      throw new BadRequestException('邮箱或密码不正确');
    }
    if (user.banned) throw new BadRequestException('该账号已被封禁，如有疑问请联系管理员');

    // 登录成功：清空失败计数与锁定
    await this.redis.del(failKey, lockKey);
    return { user };
  }

  /**
   * 设置/修改密码（需登录）。
   * 已有密码时必须提供正确的旧密码；首次设置直接生效。
   */
  async setPassword(userId: string, newPassword: string, oldPassword?: string) {
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) throw new BadRequestException(strengthError);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('用户不存在');

    if (user.passwordHash) {
      if (!oldPassword) throw new BadRequestException('请输入当前密码');
      if (!verifyPassword(oldPassword, user.passwordHash)) throw new BadRequestException('当前密码不正确');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(newPassword) },
    });
    // H5：改密后吊销该用户全部会话，旧密码泄露的会话立即失效
    await this.sessions.destroyByUserId(userId);
    return { hasPassword: true };
  }

  /** 忘记密码：校验找回验证码并重置 */
  async resetPassword(email: string, code: string, newPassword: string) {
    if (!CAMPUS_EMAIL_RE.test(email)) throw new BadRequestException('请使用成电校园邮箱（@std.uestc.edu.cn）');
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) throw new BadRequestException(strengthError);

    await this.consumeCode(email, code, RESET_PREFIX);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('验证码错误或已过期');

    await this.prisma.user.update({
      where: { email },
      data: { passwordHash: hashPassword(newPassword) },
    });
    // H5：找回密码后吊销该用户全部会话（含可能被攻击者持有的会话）
    await this.sessions.destroyByUserId(user.id);
    return { ok: true };
  }

  private today(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  private currentMinute(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function month6(day: string) {
  return day.slice(0, 6);
}

/**
 * 学号解析（Q10：学院编码规则未确认，解析失败不阻塞注册）
 * 2024080909015 → 前 4 位为年级；学院留空待人工补全
 */
export function parseStudentNo(studentNo: string): { grade: number | null; college: string | null } {
  let grade: number | null = null;
  if (studentNo.length >= 4) {
    const y = Number(studentNo.slice(0, 4));
    if (y >= 2015 && y <= 2035) grade = y;
  }
  return { grade, college: null };
}
