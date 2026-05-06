import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Mail, MailParams } from '../entities/mail/base/mail';
import { ErrorMonitoringMail, ErrorMonitoringMailInput } from '../entities/mail/error-monitoring-mail';
import { InternalMail, MailRequestInternalInput } from '../entities/mail/internal-mail';
import { MailRequestPersonalInput, PersonalMail } from '../entities/mail/personal-mail';
import { MailRequestUserInputV2, UserMailV2 } from '../entities/mail/user-mail-v2';
import { MailContext, MailContextType, MailContextTypeMapper, MailType } from '../enums';
import { MailAffix, MailRequest, MailRequestGenericInput, TranslationItem, TranslationParams } from '../interfaces';
import { WalletMailConfig } from '../services/mail.service';

export enum MailTranslationKey {
  GENERAL = 'mail.general',
  PAYMENT = 'mail.payment',
  CRYPTO_INPUT = 'mail.payment.crypto_input',
  FIAT_INPUT = 'mail.payment.fiat_input',
  CRYPTO_OUTPUT = 'mail.payment.crypto_output',
  FIAT_OUTPUT = 'mail.payment.fiat_output',
  PENDING = 'mail.payment.pending',
  CHARGEBACK = 'mail.payment.chargeback',
  CHARGEBACK_REASON = 'mail.payment.chargeback.reasons',
  CRYPTO_CHARGEBACK = 'mail.payment.chargeback.crypto',
  FIAT_CHARGEBACK = 'mail.payment.chargeback.fiat',
  REFERRAL = 'mail.referral',
  KYC = 'mail.kyc',
  KYC_STEP_NAMES = 'mail.kyc.step_names',
  KYC_SUCCESS = 'mail.kyc.success',
  KYC_FAILED = 'mail.kyc.failed',
  KYC_MISSING_DATA = 'mail.kyc.missing_data',
  KYC_FAILED_REASONS = 'mail.kyc.failed.reasons',
  KYC_REMINDER = 'mail.kyc.reminder',
  KYC_PAYMENT_DATA = 'mail.kyc.payment_data',
  LOGIN = 'mail.login',
  ACCOUNT_MERGE_REQUEST = 'mail.account_merge.request',
  ACCOUNT_MERGE_ADDED_ADDRESS = 'mail.account_merge.added_address',
  ACCOUNT_MERGE_CHANGED_MAIL = 'mail.account_merge.changed_mail',
  ACCOUNT_DEACTIVATION = 'mail.account_deactivation',
  LIMIT_REQUEST = 'mail.limit_request',
  BLACK_SQUAD = 'mail.black_squad',
  UNASSIGNED_FIAT_INPUT = 'mail.payment.fiat_input.unassigned',
  SUPPORT_MESSAGE = 'mail.support_message',
  VERIFICATION_CODE = 'mail.verification_code',
  CHARGEBACK_UNCONFIRMED = 'mail.payment.chargeback.unconfirmed',
  PROCESSING = 'mail.payment.processing',
  RECOMMENDATION_MAIL = 'mail.recommendation.recommended',
  RECOMMENDATION_CONFIRMATION = 'mail.recommendation.confirmation',
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
const DefaultEmptyLine = { text: '', style: `${UserMailDefaultStyle}` };

@Injectable()
export class MailFactory {
  constructor(private readonly i18n: I18nService) {}

  createMail(request: MailRequest): Mail | undefined {
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

      case MailType.USER_V2: {
        return this.createUserV2Mail(request);
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

  private createUserV2Mail(request: MailRequest): UserMailV2 {
    const { correlationId, options, context } = request;
    const { userData, wallet, title, salutation, texts } = request.input as MailRequestUserInputV2;

    if (this.isDisabledMailWallet(context, wallet)) return undefined;

    const walletName = wallet?.name;
    const walletMailConfig = walletName ? Config.mail.wallet[walletName] : undefined;
    const lang = walletMailConfig?.forcedLang
      ? walletMailConfig.forcedLang.toLowerCase()
      : userData.language.symbol.toLowerCase();

    const welcomeTexts = this.getCentralizedWelcomeTexts(userData, walletMailConfig);
    const walletBodyTexts = this.getWalletBodyTexts(title, lang, walletName);
    // Order: welcome line (if any), then optional wallet body override, then the service-specific texts
    const merged = [...welcomeTexts, ...walletBodyTexts, ...(texts ?? [])];
    const allTexts = this.getMailAffix(merged, lang, walletName);

    return new UserMailV2(
      {
        to: userData.mail,
        subject: this.translate(title, lang, undefined, walletName),
        salutation: salutation && this.translate(salutation.key, lang, salutation.params, walletName),
        texts: allTexts,
        correlationId,
        options,
      },
      wallet,
    );
  }

  private createPersonalMail(request: MailRequest): PersonalMail {
    const { userData, title, prefix, banner, from, displayName, bcc, wallet } =
      request.input as MailRequestPersonalInput;
    const { correlationId, options, context } = request;

    if (this.isDisabledMailWallet(context, wallet)) return undefined;

    const walletName = wallet?.name;
    const walletMailConfig = walletName ? Config.mail.wallet[walletName] : undefined;
    const lang = walletMailConfig?.forcedLang
      ? walletMailConfig.forcedLang.toLowerCase()
      : userData.language.symbol.toLowerCase();

    const welcomeTexts = this.getCentralizedWelcomeTexts(userData, walletMailConfig);
    const walletBodyTexts = this.getWalletBodyTexts(title, lang, walletName);
    const merged = [...welcomeTexts, ...walletBodyTexts, ...(prefix ?? [])];

    return new PersonalMail({
      to: userData.mail,
      bcc,
      subject: this.translate(title, lang, undefined, walletName),
      prefix: this.getMailAffix(merged, lang, walletName),
      banner,
      from,
      displayName,
      correlationId,
      options,
    });
  }

  //*** TRANSLATION METHODS ***//

  public translate(key: string, lang: string, args?: any, walletName?: string): string {
    if (walletName) {
      const walletKey = key.replace(/^mail\./, `mail-${walletName.toLowerCase()}.`);
      const walletTranslation = this.i18n.translate(walletKey, { lang: lang.toLowerCase(), args }) as string;

      if (walletTranslation !== walletKey) return walletTranslation;
    }

    return this.i18n.translate(key, { lang: lang.toLowerCase(), args });
  }

  private translateWalletOnly(key: string, lang: string, walletName: string, args?: any): string | undefined {
    const walletKey = key.replace(/^mail\./, `mail-${walletName.toLowerCase()}.`);
    const walletTranslation = this.i18n.translate(walletKey, { lang: lang.toLowerCase(), args }) as string;

    return walletTranslation !== walletKey ? walletTranslation : undefined;
  }

  private getWalletBodyTexts(title: string, lang: string, walletName?: string): TranslationItem[] {
    if (!walletName) return [];

    const bodyKey = title.replace(/\.title$/, '.body');
    const bodyText = this.translateWalletOnly(bodyKey, lang, walletName);

    return bodyText ? [{ key: bodyKey }] : [];
  }

  // Personal welcome line, prepended to every UserMailV2 / PersonalMail of wallets that opt in via centralizedWelcome (e.g. RealUnit).
  // Default DFX mails return an empty list so their existing behavior stays unchanged.
  private getCentralizedWelcomeTexts(
    userData: UserData,
    walletMailConfig?: Partial<WalletMailConfig>,
  ): TranslationItem[] {
    if (!walletMailConfig?.centralizedWelcome) return [];

    return [
      {
        key: `${MailTranslationKey.GENERAL}.welcome`,
        params: { name: userData.organizationName ?? userData.firstname },
      },
      { key: MailKey.SPACE, params: { value: '2' } },
    ];
  }

  //*** MAIL BUILDING METHODS ***//

  private isDisabledMailWallet(context: MailContext, wallet: Wallet): boolean {
    if (wallet && !wallet.disabledMailTypes) wallet = Object.assign(new Wallet(), wallet);
    const mailContextType = MailContextTypeMapper[context];
    return (
      mailContextType &&
      (wallet?.disabledMailTypes.includes(mailContextType) || wallet?.disabledMailTypes.includes(MailContextType.ALL))
    );
  }

  private getMailAffix(affix: TranslationItem[], lang = 'en', walletName?: string): MailAffix[] {
    return affix
      .filter((i) => i)
      .map((i) => this.mapMailAffix(i, lang, walletName).flat())
      .flat();
  }

  private mapMailAffix(element: TranslationItem, lang: string, walletName?: string): MailAffix[] {
    switch (element.key) {
      case MailKey.SPACE:
        return [DefaultEmptyLine];

      case MailKey.DFX_TEAM_CLOSING:
        // Skip the DFX closing block only for wallets that opt in to RealUnit-style branding (centralizedWelcome).
        // Other custom-template wallets (e.g. onchainlabs) keep the existing behavior unchanged.
        if (walletName && Config.mail.wallet[walletName]?.centralizedWelcome) return [];

        return [
          DefaultEmptyLine,
          {
            text: this.translate(`${MailTranslationKey.GENERAL}.dfx_team_closing`, lang),
            style: UserMailDefaultStyle,
          },
          { text: this.translate(`${MailTranslationKey.GENERAL}.dfx_closing_message`, lang), style: 'Zapfino' },
          DefaultEmptyLine,
          DefaultEmptyLine,
        ];

      default: {
        const params = Util.removeNullFields(element.params);
        const translatedParams = this.translateParams(params, lang, walletName);
        const text = this.translate(element.key, lang, translatedParams, walletName);
        const specialTag = this.parseSpecialTag(text);

        // Skip if a wallet override resolves to an empty string and no special tag is set (e.g. RealUnit's explicitly cleared transaction_button).
        // Only applies to wallets that opted in to RealUnit-style branding (centralizedWelcome) so DFX-default rendering is unchanged.
        if (!text && !specialTag && walletName && Config.mail.wallet[walletName]?.centralizedWelcome) return [];

        return [
          {
            url:
              specialTag?.tag === 'url'
                ? {
                    link: element.params?.url ?? specialTag.value,
                    button: element.params?.button,
                    text: specialTag.value,
                    textSuffix: specialTag.textSuffix,
                  }
                : undefined,
            mail:
              specialTag?.tag === 'mail'
                ? {
                    address: specialTag.value,
                    textSuffix: specialTag.textSuffix,
                    button: element.params?.button,
                  }
                : undefined,
            style: element.params?.style ?? UserMailDefaultStyle,
            text: specialTag?.text ?? text,
            marginBottom: element.params?.marginBottom ?? '10px',
            marginTop: element.params?.marginTop ?? '10px',
            underline: element.params?.underline,
          },
        ];
      }
    }
  }

  private parseSpecialTag(text: string): SpecialTag | undefined {
    const match = /^(.*)\[(\w+):([^\]]+)\](.*)$/.exec(text);
    return match ? { text: match[1], textSuffix: match[4], tag: match[2], value: match[3] } : undefined;
  }

  private translateParams(params: TranslationParams, lang: string, walletName?: string): TranslationParams {
    return params
      ? Object.entries(params)
          .map(([key, value]) => [key, this.translate(value, lang, params, walletName)])
          .reduce((prev, [key, value]) => {
            prev[key] = value;
            return prev;
          }, {})
      : {};
  }

  //*** STATIC HELPER METHODS ***//

  static parseMailKey(mailKey: MailTranslationKey, value: string): string {
    return `${mailKey}.${value.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`;
  }
}
