import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { ErrorMail, ErrorMailInput } from '../entities/mail/error-mail';
import { KycMailInput, KycSupportMail } from '../entities/mail/kyc-mail';
import { Mail } from '../entities/mail/mail';
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

      case MailType.ERROR: {
        return this.createErrorMail(request);
      }

      case MailType.KYC: {
        return this.createKycMail(request);
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

  private createGenericMail(request: MailRequest): ErrorMail {
    const input = request.input as MailRequestGenericInput;
    const { metadata, options } = request;

    return new Mail({ ...input, metadata, options });
  }

  private createErrorMail(request: MailRequest): ErrorMail {
    const { subject, errors } = request.input as ErrorMailInput;
    const { metadata, options } = request;

    return new ErrorMail({ subject, errors, metadata, options });
  }

  private createKycMail(request: MailRequest): KycSupportMail {
    const { userData } = request.input as KycMailInput;
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
