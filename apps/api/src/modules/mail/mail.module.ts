import { Global, Injectable, Logger, Module } from '@nestjs/common';
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
     * 【阶段措施】当前阶段不实装真实发信（属路线图），因此**不再** fail-fast，
     * 生产环境用 console provider 时打 WARN 后照常启动——否则部署无法完成。
     *
     * 已知风险：此模式下验证码只写入服务端日志（见 ConsoleDevProvider），
     * 能读取日志者即可为任意邮箱取码登录，故生产日志必须按「等同凭据」的级别管控访问。
     *
     * 退出条件：实装 QqSmtpProvider 并设 MAIL_PROVIDER=qq 后，本分支不再被走到，
     * 届时请把这段告警改为启动即拒绝（fail-fast）。
     */
    if (process.env.NODE_ENV === 'production') {
      new Logger('Mail').warn(
        '生产环境正在使用 console 邮件通道（阶段措施）：验证码仅写入服务端日志，未真实发信。' +
          '日志访问权限等同账号登录权限，请严格管控；正式上线前请实装 SMTP 并设 MAIL_PROVIDER=qq。',
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
