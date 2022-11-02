import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { ErrorMonitoringMail, ErrorMonitoringMailInput } from '../entities/mail/error-monitoring-mail';
import { KycSupportMailInput, KycSupportMail } from '../entities/mail/kyc-support-mail';
import { Mail } from '../entities/mail/base/mail';
import { UserMail, UserMailInput } from '../entities/mail/user-mail';
import { MailType } from '../enums';
import { MailRequest, MailRequestGenericInput } from '../interfaces';

@Injectable()
export class MailFactory {
  constructor(private readonly i18n: I18nService) {}

  async createMail(request: MailRequest): Promise<Mail> {
    switch (request.type) {
      case MailType.GENERIC: {
        return this.createGenericMail(request);
      }

      case MailType.ERROR_MONITORING: {
        return this.createErrorMonitoringMail(request);
      }

      case MailType.KYC_SUPPORT: {
        return this.createKycSupportMail(request);
      }

      case MailType.USER: {
        return this.createUserMail(request);
      }

      default: {
        throw new Error(`Unsupported mail type: ${request.type}`);
      }
    }
  }

  //*** HELPER METHODS ***//

  private createGenericMail(request: MailRequest): ErrorMonitoringMail {
    const input = request.input as MailRequestGenericInput;
    const { metadata, options } = request;

    return new Mail({ ...input, metadata, options });
  }

  private createErrorMonitoringMail(request: MailRequest): ErrorMonitoringMail {
    const { subject, errors } = request.input as ErrorMonitoringMailInput;
    const { metadata, options } = request;

    return new ErrorMonitoringMail({ subject, errors, metadata, options });
  }

  private createKycSupportMail(request: MailRequest): KycSupportMail {
    const { userData } = request.input as KycSupportMailInput;
    const { metadata, options } = request;

    return new KycSupportMail({
      userDataId: userData.id,
      kycStatus: userData.kycStatus,
      kycCustomerId: userData.kycCustomerId,
      metadata,
      options,
    });
  }

  private async createUserMail(request: MailRequest): Promise<UserMail> {
    const { userData, translationKey, translationParams } = request.input as UserMailInput;
    const { metadata, options } = request;

    const { subject, salutation, body } = await this.t(
      translationKey,
      userData.language?.symbol.toLowerCase(),
      translationParams,
    );

    return new UserMail({
      to: userData.mail,
      subject,
      salutation,
      body,
      metadata,
      options,
    });
  }

  //*** TRANSLATION METHODS ***//

  private async t(
    key: string,
    lang: string,
    args?: any,
  ): Promise<{ salutation: string; body: string; subject: string }> {
    const salutation = await this.i18n.translate(`${key}.salutation`, { lang, args });
    const body = await this.i18n.translate(`${key}.body`, { lang, args });
    const subject = await this.i18n.translate(`${key}.title`, { lang, args });

    return { salutation, body, subject };
  }
}
