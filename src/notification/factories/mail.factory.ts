import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { ErrorMail } from '../entities/mail/error-mail';
import { KycSupportMail } from '../entities/mail/kyc-mail';
import { Mail } from '../entities/mail/mail';
import { UserMail } from '../entities/mail/user-mail';
import { MailType } from '../enums';
import { MailRequest } from '../interfaces';

@Injectable()
export class MailFactory {
  constructor(private readonly i18n: I18nService) {}

  async createMail(request: MailRequest): Promise<Mail> {
    switch (request.type) {
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

  private createErrorMail(request: MailRequest): ErrorMail {
    const {
      data: { subject, errors },
      options,
    } = request;

    return new ErrorMail({ subject, errors }, { notificationOptions: options });
  }

  private createKycMail(request: MailRequest): KycSupportMail {
    const {
      data: { userData, kycCustomerId },
      options,
    } = request;

    return new KycSupportMail(
      { userDataId: userData.id, kycStatus: userData.kycStatus, kycCustomerId },
      { notificationOptions: options },
    );
  }

  private async createUserMail(request: MailRequest): Promise<UserMail> {
    const {
      data: { userData, translationKey, translationParams },
      options,
    } = request;

    const { subject, salutation, body } = await this.t(
      translationKey,
      userData.language?.symbol.toLowerCase(),
      translationParams,
    );

    return new UserMail({ to: userData.mail, subject, salutation, body }, { notificationOptions: options });
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
