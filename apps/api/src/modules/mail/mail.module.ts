import { Global, Injectable, Module } from '@nestjs/common';
import { type MailProvider, type MailMessage } from './mail-provider.interface';
import { ConsoleDevProvider } from './console-dev.provider';
import { QqSmtpProvider } from './qq-smtp.provider';

/** 按 MAIL_PROVIDER 选择实现；未配置时一律走 console-dev，保证登录流程可联调 */
@Injectable()
export class MailService {
  private readonly provider: MailProvider;

  constructor(consoleDev: ConsoleDevProvider, qq: QqSmtpProvider) {
    const name = process.env.MAIL_PROVIDER ?? 'console';
    if (name === 'qq') {
      this.provider = qq;
      return;
    }
    /**
     * 2026-09-27 安全收敛（docs/UESTC-TeamUp_main_issues.md A2）：
     * 生产环境直接拒绝以 console provider 启动 —— console 模式下验证码只写入服务端日志，
     * 「日志读取权限 ≈ 任意账号登录权限」，不能作为生产兜底。
     * 生产部署必须配置 MAIL_PROVIDER=qq（或其他真实 provider）。
     */
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[mail] 生产环境禁止 MAIL_PROVIDER=console：验证码会写入服务端日志（等同登录凭据）。' +
          '请配置真实邮件 provider（如 MAIL_PROVIDER=qq 及对应 SMTP 授权码）后启动。',
      );
    }
    this.provider = consoleDev;
  }

  async send(msg: MailMessage) {
    await this.provider.send(msg);
  }
}

@Global()
@Module({
  providers: [ConsoleDevProvider, QqSmtpProvider, MailService],
  exports: [MailService],
})
export class MailModule {}
