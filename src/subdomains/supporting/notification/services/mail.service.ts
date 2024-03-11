import { MailerOptions, MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateMailInput } from '../dto/create-mail.dto';
import { Mail } from '../entities/mail.entity';
import { MailBase } from '../entities/mail/base/mail';
import { MailRepository } from '../repositories/mail.repository';

export interface MailOptions {
  options: MailerOptions;
  defaultMailTemplate: string;
  contact: {
    supportMail: string;
    monitoringMail: string;
    liqMail: string;
    noReplyMail: string;
  };
}

@Injectable()
export class MailService {
  private readonly logger = new DfxLogger(MailService);

  constructor(private readonly mailerService: MailerService, private readonly mailRepo: MailRepository) {}

  async createOrUpdate(dto: CreateMailInput): Promise<Mail> {
    const existing = await this.mailRepo.findOne({
      where: {
        type: dto.type,
        context: dto.context,
        data: dto.data,
        isComplete: dto.isComplete,
        error: dto.error,
      },
    });
    if (existing) {
      Object.assign(existing, dto);

      return this.mailRepo.save(existing);
    }

    const entity = this.mailRepo.create(dto);

    return this.mailRepo.save(entity);
  }

  async send(mail: MailBase): Promise<void> {
    try {
      await this.mailerService.sendMail({
        from: mail.from,
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        template: mail.template,
        context: mail.templateParams,
      });
    } catch (e) {
      this.logger.error(
        `Exception sending mail (from:${mail.from.name}<${mail.from.address}>, to:${mail.to}, subject:${mail.subject}):`,
        e,
      );
      throw e;
    }
  }
}
