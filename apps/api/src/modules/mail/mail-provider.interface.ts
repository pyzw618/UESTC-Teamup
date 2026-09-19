/**
 * MailProvider 抽象（MODULE_AUTH §4 —— 本模块最重要的设计决策）
 * 业务代码不允许出现任何 QQ 相关硬编码；邮件功能本次留空，仅 ConsoleDevProvider。
 */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailProvider {
  readonly name: string;
  send(msg: MailMessage): Promise<void>;
  /** 剩余额度，用于降级判断；不确定时返回 null */
  quotaLeft?(): Promise<number | null>;
}
