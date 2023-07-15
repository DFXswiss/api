import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { Mail, MailParams } from '../entities/mail/base/mail';
import { ErrorMonitoringMail, ErrorMonitoringMailInput } from '../entities/mail/error-monitoring-mail';
import { KycSupportMail, KycSupportMailInput } from '../entities/mail/kyc-support-mail';
import { PersonalMail, PersonalMailInput } from '../entities/mail/personal-mail';
import { UserMail, UserMailInput, UserMailNew, UserMailSuffix, UserMailTable } from '../entities/mail/user-mail';
import { MailType } from '../enums';
import { MailRequest, MailRequestGenericInput, MailRequestInput, MailRequestNew, TranslationItem } from '../interfaces';

export enum MailTranslationKey {
  GENERAL = 'translation.general',
  PAYMENT = 'translation.payment',
  BUY_FIAT = 'translation.payment.buy_fiat',
  BUY_CRYPTO = 'translation.payment.buy_crypto',
  PENDING = 'translation.payment.pending',
  RETURN = 'translation.payment.return',
  CRYPTO_RETURN = 'translation.payment.return.crypto',
  FIAT_RETURN = 'translation.payment.return.fiat',
}

export enum MailKey {
  SPACE = 'space',
  DFX_TEAM_CLOSING = 'dfxTeamClosing',
}

interface SpecialTag {
  text: string;
  textSuffix: string;
  tag: string;
  value: string;
}

const MailDefaultStyle = 'Open Sans,Helvetica,Arial,sans-serif';
const MailDefaultEmptyLine = { text: '', style: `${MailDefaultStyle};padding:1px` };

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

      case MailType.PERSONAL: {
        return this.createPersonalMail(request);
      }

      case MailType.INTERNAL: {
        return this.createInternalMail(request);
      }

      default: {
        throw new Error(`Unsupported mail type: ${request.type}`);
      }
    }
  }

  async createMailNew(request: MailRequestNew): Promise<Mail> {
    switch (request.type) {
      case MailType.USER: {
        return this.createUserMailNew(request);
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

    const defaultParams: Partial<MailRequestGenericInput> = {
      twitterUrl: Config.defaultTwitterUrl,
      telegramUrl: Config.defaultTelegramUrl,
      linkedinUrl: Config.defaultLinkedinUrl,
      instagramUrl: Config.defaultInstagramUrl,
      date: new Date().getFullYear(),
    };

    const mailParams: MailParams = {
      ...input,
      templateParams: { ...defaultParams, ...input },
      metadata,
      options,
    };

    return new Mail(mailParams);
  }

  private createInternalMail(request: MailRequest): ErrorMonitoringMail {
    const input = request.input as MailRequestGenericInput;
    const { metadata, options } = request;

    const mailParams: MailParams = {
      ...input,
      template: 'support',
      templateParams: { date: new Date().getFullYear(), ...input },
      metadata,
      options,
    };

    return new Mail(mailParams);
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

  private async createUserMailNew(request: MailRequestNew): Promise<UserMailNew> {
    const { metadata, options } = request;
    const { userData, title, prefix, suffix, table } = request.input as MailRequestInput;

    const lang = userData.language?.symbol.toLowerCase();

    return new UserMailNew({
      to: userData.mail,
      subject: this.tNew(title, lang),
      salutation: this.tNew(prefix.key, lang, prefix.params),
      table: this.getTable(table, lang),
      suffix: this.getSuffix(suffix, lang),
      metadata,
      options,
    });
  }

  private async createPersonalMail(request: MailRequest): Promise<PersonalMail> {
    const { userData, translationKey, translationParams, banner, displayName, from } =
      request.input as PersonalMailInput;
    const { metadata, options } = request;

    const { subject, salutation, body } = await this.t(
      translationKey,
      userData.language?.symbol.toLowerCase(),
      translationParams,
    );

    return new PersonalMail({
      to: userData.mail,
      subject,
      salutation,
      body,
      banner,
      displayName,
      from,
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
    const salutation = this.i18n.translate(`${key}.salutation`, { lang, args });
    const body = this.i18n.translate(`${key}.body`, { lang, args });
    const subject = this.i18n.translate(`${key}.title`, { lang, args });

    return { salutation, body, subject };
  }

  private tNew(key: string, lang: string, args?: any): string {
    return this.i18n.translate(key, { lang, args });
  }

  //*** MAIL BUILDING METHODS ***//

  private getTable(table: Record<string, string>, lang: string): UserMailTable[] {
    Util.removeNullFields(table);
    return Object.entries(table).map(([key, value]) => ({
      text: this.tNew(key, lang),
      value: value,
    }));
  }

  private getSuffix(suffix: TranslationItem[], lang: string): UserMailSuffix[] {
    Util.removeNullFields(this.combineConnectedLineElements(suffix));
    return suffix.map((element) => this.mapSuffix(element, lang).flat()).flat();
  }

  private mapSuffix(element: TranslationItem, lang: string): UserMailSuffix[] {
    switch (element.key) {
      case MailKey.SPACE:
        return [MailDefaultEmptyLine];

      case MailKey.DFX_TEAM_CLOSING:
        return [
          MailDefaultEmptyLine,
          MailDefaultEmptyLine,
          {
            text: this.tNew(`${MailTranslationKey.GENERAL}.dfx_team_closing`, lang),
            style: MailDefaultStyle,
          },
          MailDefaultEmptyLine,
          MailDefaultEmptyLine,
          MailDefaultEmptyLine,
          MailDefaultEmptyLine,
          { text: this.tNew(`${MailTranslationKey.GENERAL}.dfx_closing_message`, lang), style: 'Zapfino' },
        ];

      default:
        const text =
          element.key.split('&&').length > 1
            ? element.key
                .split('&&')
                .map((splitKey) => this.tNew(splitKey, lang))
                .join('')
            : this.tNew(element.key, lang);
        const specialTag = this.parseSpecialTag(text);

        return [
          {
            url:
              specialTag?.tag === 'url' && element.params?.url
                ? {
                    link: element.params.url,
                    text: specialTag.value,
                    textSuffix: specialTag.textSuffix,
                  }
                : undefined,
            mail:
              specialTag?.tag === 'mail'
                ? { mailAddress: specialTag.value, textSuffix: specialTag.textSuffix }
                : undefined,
            style: element.params?.style ?? MailDefaultStyle,
            text: specialTag?.text ?? text,
          },
        ];
    }
  }

  private combineConnectedLineElements(suffix: TranslationItem[]): TranslationItem[] {
    for (let index = 0; index < suffix.length - 1; index++) {
      if (suffix[index]?.params?.connectNextLine) {
        suffix[index + 1].key = `${suffix[index].key}&&${suffix[index + 1].key}`;
        suffix[index] = null;
      }
    }
    return suffix;
  }

  private parseSpecialTag(text: string): SpecialTag | undefined {
    const match = /^(.*)\[(\w+):([^\]]+)\](.*)$/.exec(text);
    return match ? { text: match[1], textSuffix: match[4], tag: match[2], value: match[3] } : undefined;
  }
}
