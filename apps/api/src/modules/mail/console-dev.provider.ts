import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailProvider } from './mail-provider.interface';

/**
 * 当前阶段的兜底实现：不真正发信，验证码/内容打印到控制台。
 *
 * 【阶段措施·已知风险】本阶段不实装真实发信，验证码**只能**从服务端日志获取
 * （验证码登录同时是「首次即注册」通道），因此：
 *   - 能读取生产日志的人可为任意邮箱取码登录 → 生产日志必须按凭据级别管控访问，
 *     不要接入第三方日志采集平台、不要外发；
 *   - 正式上线前须实装 QqSmtpProvider 并设 MAIL_PROVIDER=qq，此后本 provider 不再被使用。
 */
@Injectable()
export class ConsoleDevProvider implements MailProvider {
  readonly name = 'console-dev';
  private readonly logger = new Logger('Mail');

  async send(msg: MailMessage): Promise<void> {
    this.logger.log(`[未接入真实邮件·阶段措施] to=${msg.to} subject=${msg.subject}`);
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn('以下为验证码正文（阶段措施）：请勿外泄日志、勿接入第三方日志平台');
    }
    this.logger.log(`----------------------------------------`);
    this.logger.log(msg.text ?? msg.html.replace(/<[^>]+>/g, ' '));
    this.logger.log(`----------------------------------------`);
  }
}
