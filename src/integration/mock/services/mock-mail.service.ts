import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';

interface MockMail {
  to: string;
  subject: string;
  template?: string;
  context?: any;
  sentAt: Date;
}

@Injectable()
export class MockMailService {
  private readonly logger = new DfxLogger(MockMailService);
  private readonly sentMails: MockMail[] = [];

  async sendMail(options: { to: string; subject: string; template?: string; context?: any }): Promise<void> {
    const mail: MockMail = {
      to: options.to,
      subject: options.subject,
      template: options.template,
      context: options.context,
      sentAt: new Date(),
    };

    this.sentMails.push(mail);
    this.logger.verbose(`Mock: Email to ${options.to} - "${options.subject}"`);
  }

  // Helper methods for testing
  getSentMails(): MockMail[] {
    return [...this.sentMails];
  }

  getLastMail(): MockMail | undefined {
    return this.sentMails[this.sentMails.length - 1];
  }

  getMailsTo(email: string): MockMail[] {
    return this.sentMails.filter((m) => m.to === email);
  }

  clearMails(): void {
    this.sentMails.length = 0;
  }
}
