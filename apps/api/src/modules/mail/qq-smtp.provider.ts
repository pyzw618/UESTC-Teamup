import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailProvider } from './mail-provider.interface';

/**
 * QQ SMTP 实现桩 —— 邮件功能本次留空，待 P0 实测（QQ 授权码 + 送达率验证）后补全。
 * 实现时用 nodemailer 连 smtp.qq.com:465(SSL)，并遵守 MODULE_AUTH §5 的防垃圾邮件做法。
 */
@Injectable()
export class QqSmtpProvider implements MailProvider {
  readonly name = 'qq-smtp';
  private readonly logger = new Logger('Mail');

  async send(_msg: MailMessage): Promise<void> {
    this.logger.warn('QqSmtpProvider 为留空桩：请在 .env 配置 QQ_SMTP_USER/PASS 并实现 nodemailer 发送');
    throw new Error('邮件发送未接入（本次留空），请使用 MAIL_PROVIDER=console');
  }
}
