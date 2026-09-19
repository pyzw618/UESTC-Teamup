import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailProvider } from './mail-provider.interface';

/**
 * 开发期兜底：不真正发信，验证码/内容打印到控制台。
 * 就绪后配置 MAIL_PROVIDER=qq 即切换。
 */
@Injectable()
export class ConsoleDevProvider implements MailProvider {
  readonly name = 'console-dev';
  private readonly logger = new Logger('Mail');

  async send(msg: MailMessage): Promise<void> {
    this.logger.log(`[DEV 未接入真实邮件] to=${msg.to} subject=${msg.subject}`);
    this.logger.log(`----------------------------------------`);
    this.logger.log(msg.text ?? msg.html.replace(/<[^>]+>/g, ' '));
    this.logger.log(`----------------------------------------`);
  }
}
