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
    this.provider = name === 'qq' ? qq : consoleDev;
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
