import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { Mail, MailParams } from '../entities/mail/base/mail';
import { ErrorMonitoringMail, ErrorMonitoringMailInput } from '../entities/mail/error-monitoring-mail';
import { InternalMail, MailRequestInternalInput } from '../entities/mail/internal-mail';
import { MailRequestPersonalInput, PersonalMail } from '../entities/mail/personal-mail';
import { MailRequestUserInput, UserMail, UserMailTable } from '../entities/mail/user-mail';
import { MailType } from '../enums';
import { MailAffix, MailRequest, MailRequestGenericInput, TranslationItem, TranslationParams } from '../interfaces';

export enum MailTranslationKey {
  GENERAL = 'mail.general',
  PAYMENT = 'mail.payment',
  CRYPTO_INPUT = 'mail.payment.crypto_input',
  FIAT_INPUT = 'mail.payment.fiat_input',
  PENDING = 'mail.payment.pending',
  RETURN = 'mail.payment.return',
  RETURN_REASON = 'mail.payment.return.reasons',
  CRYPTO_RETURN = 'mail.payment.return.crypto',
  FIAT_RETURN = 'mail.payment.return.fiat',
  REFERRAL = 'mail.referral',
  KYC = 'mail.kyc',
  KYC_SUCCESS = 'mail.kyc.success',
  KYC_FAILED = 'mail.kyc.failed',
  KYC_REMINDER = 'mail.kyc.reminder',
  LOGIN = 'mail.login',
  ACCOUNT_MERGE_REQUEST = 'mail.account_merge.request',
  ACCOUNT_MERGE_ADDED_ADDRESS = 'mail.account_merge.added_address',
  ACCOUNT_MERGE_CHANGED_MAIL = 'mail.account_merge.changed_mail',
  LIMIT_REQUEST = 'mail.limit_request',
  BLACK_SQUAD = 'mail.black_squad',
  UNASSIGNED_FIAT_INPUT = 'mail.payment.fiat_input.unassigned',
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

const UserMailDefaultStyle = 'Open Sans,Helvetica,Arial,sans-serif';
const DefaultEmptyLine = { text: '', style: `${UserMailDefaultStyle};padding:1px` };

@Injectable()
export class MailFactory {
  constructor(private readonly i18n: I18nService) {}

  createMail(request: MailRequest): Mail {
    switch (request.type) {
      case MailType.INTERNAL: {
        return this.createInternalMail(request);
      }

      case MailType.GENERIC: {
        return this.createGenericMail(request);
      }

      case MailType.ERROR_MONITORING: {
        return this.createErrorMonitoringMail(request);
      }

      case MailType.USER: {
        return this.createUserMail(request);
      }

      case MailType.PERSONAL: {
        return this.createPersonalMail(request);
      }

      default: {
        throw new Error(`Unsupported mail type: ${request.type}`);
      }
    }
  }

  //*** HELPER METHODS ***//

  private createInternalMail(request: MailRequest): InternalMail {
    const input = request.input as MailRequestInternalInput;
    const { title, salutation, prefix } = request.input as MailRequestInternalInput;
    const { correlationId, options } = request;

    return new InternalMail({
      ...{ date: new Date().getFullYear(), ...input },
      subject: title,
      salutation: salutation?.key,
      prefix: prefix && this.getMailAffix(prefix),
      correlationId,
      options,
    });
  }

  private createGenericMail(request: MailRequest): Mail {
    const input = request.input as MailRequestGenericInput;
    const { correlationId, options } = request;

    const defaultParams: Partial<MailRequestGenericInput> = {
      twitterUrl: Config.social.twitter,
      telegramUrl: Config.social.telegram,
      linkedinUrl: Config.social.linkedin,
      instagramUrl: Config.social.instagram,
      date: new Date().getFullYear(),
    };

    const mailParams: MailParams = {
      ...input,
      templateParams: { ...defaultParams, ...input },
      correlationId,
      options,
    };

    return new Mail(mailParams);
  }

  private createErrorMonitoringMail(request: MailRequest): ErrorMonitoringMail {
    const { subject, errors } = request.input as ErrorMonitoringMailInput;
    const { correlationId, options } = request;

    return new ErrorMonitoringMail({ subject, errors, correlationId, options });
  }

  private createUserMail(request: MailRequest): UserMail {
    const { correlationId, options } = request;
    const { userData, title, salutation, prefix, suffix, table } = request.input as MailRequestUserInput;

    const lang = userData.language.symbol.toLowerCase();

    return new UserMail({
      to: userData.mail,
      subject: this.translate(title, lang),
      salutation: salutation && this.translate(salutation.key, lang, salutation.params),
      prefix: prefix && this.getMailAffix(prefix, lang),
      table: table && this.getTable(table, lang),
      suffix: suffix && this.getMailAffix(suffix, lang),
      correlationId,
      options,
    });
  }

  private createPersonalMail(request: MailRequest): PersonalMail {
    const { userData, title, prefix, banner, from, displayName } = request.input as MailRequestPersonalInput;
    const { correlationId, options } = request;

    const lang = userData.language.symbol.toLowerCase();

    return new PersonalMail({
      to: userData.mail,
      subject: this.translate(title, lang),
      prefix: prefix && this.getMailAffix(prefix, lang),
      banner,
      from,
      displayName,
      correlationId,
      options,
    });
  }

  //*** TRANSLATION METHODS ***//

  private translate(key: string, lang: string, args?: any): string {
    return this.i18n.translate(key, { lang, args });
  }

  //*** MAIL BUILDING METHODS ***//

  private getTable(table: Record<string, string>, lang: string): UserMailTable[] {
    Util.removeNullFields(table);
    return Object.entries(table).map(([key, value]) => ({
      text: this.translate(key, lang),
      value: value,
    }));
  }

  private getMailAffix(affix: TranslationItem[], lang = 'en'): MailAffix[] {
    Util.removeNullFields(affix);
    return affix.map((element) => this.mapMailAffix(element, lang).flat()).flat();
  }

  private mapMailAffix(element: TranslationItem, lang: string): MailAffix[] {
    switch (element.key) {
      case MailKey.SPACE:
        return [DefaultEmptyLine];

      case MailKey.DFX_TEAM_CLOSING:
        return [
          DefaultEmptyLine,
          DefaultEmptyLine,
          {
            text: this.translate(`${MailTranslationKey.GENERAL}.dfx_team_closing`, lang),
            style: UserMailDefaultStyle,
          },
          DefaultEmptyLine,
          DefaultEmptyLine,
          DefaultEmptyLine,
          DefaultEmptyLine,
          { text: this.translate(`${MailTranslationKey.GENERAL}.dfx_closing_message`, lang), style: 'Zapfino' },
        ];

      default:
        if (element.params) Util.removeNullFields(element.params);
        const translatedParams = this.translateParams(element.params, lang);
        const text = this.translate(element.key, lang, translatedParams);
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
              specialTag?.tag === 'mail' ? { address: specialTag.value, textSuffix: specialTag.textSuffix } : undefined,
            style: element.params?.style ?? UserMailDefaultStyle,
            text: specialTag?.text ?? text,
          },
        ];
    }
  }

  private parseSpecialTag(text: string): SpecialTag | undefined {
    const match = /^(.*)\[(\w+):([^\]]+)\](.*)$/.exec(text);
    return match ? { text: match[1], textSuffix: match[4], tag: match[2], value: match[3] } : undefined;
  }

  private translateParams(params: TranslationParams, lang: string): TranslationParams {
    return params
      ? Object.entries(params)
          .map(([key, value]) => [key, this.translate(value, lang, params)])
          .reduce((prev, [key, value]) => {
            prev[key] = value;
            return prev;
          }, {})
      : {};
  }

  //*** STATIC HELPER METHODS ***//

  static parseMailKey(mailKey: MailTranslationKey, amlReason: AmlReason): string {
    return `${mailKey}.${amlReason.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`;
  }
}
