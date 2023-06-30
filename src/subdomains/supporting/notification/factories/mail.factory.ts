import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import { I18nService } from 'nestjs-i18n';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { Mail, MailParams } from '../entities/mail/base/mail';
import { ErrorMonitoringMail, ErrorMonitoringMailInput } from '../entities/mail/error-monitoring-mail';
import { KycSupportMail, KycSupportMailInput } from '../entities/mail/kyc-support-mail';
import { PersonalMail, PersonalMailInput } from '../entities/mail/personal-mail';
import { UserMail, UserMailInput } from '../entities/mail/user-mail';
import { MailType } from '../enums';
import { MailRequest, MailRequestGenericInput, MailRequestInput, MailRequestNew, TranslationItem } from '../interfaces';

export enum MailTranslationKey {
  GENERAL = 'translation.general',
  PAYMENT = 'translation.payment',
  BUY_FIAT = 'translation.payment.buy_fiat',
}

export enum MailKey {
  SPACE = 'space',
  DFX_TEAM_CLOSING = 'dfxTeamClosing',
}

enum MailStructurePart {
  EMPTY_ENTRY = '<td style="width:2%;"></td>',
  EMPTY_LINE = '<tr style="padding:1px"><td colspan="3"> </td></tr>',
  DEFAULT_STYLE = 'Open Sans,Helvetica,Arial,sans-serif',
}

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

  private async createUserMailNew(request: MailRequestNew): Promise<UserMail> {
    const { metadata, options } = request;
    const { userData, title, prefix, suffix, table } = request.input as MailRequestInput;

    const lang = userData.language?.symbol.toLowerCase();

    return new UserMail({
      to: userData.mail,
      subject: this.tNew(title, lang),
      salutation: this.tNew(prefix.key, lang, prefix.params),
      body: this.buildBody(table, suffix, lang),
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

  private buildBody(table: Record<string, string>, suffix: TranslationItem[], lang: string): string {
    const bodyTemplate = Handlebars.compile(
      `<table style="font-family:Open Sans,Helvetica,Arial,sans-serif;width:60%;padding:8px;font-size:85%" align="center">
      {{#each table}}<tr><td align=\"right\">{{this.key}}</td>${MailStructurePart.EMPTY_ENTRY}<td align=\"left\">{{this.value}}</td></tr>{{/each}}
      {{#each suffix}}
      {{#if this.space}}{{#each this.space}}${MailStructurePart.EMPTY_LINE}{{/each}}{{/if}}
      {{#unless this.space}}<tr style=\"font-family:{{this.style}}\"><td colspan=\"3\" align=\"center\">
      {{#if this.url}}{{this.key}}<a style=\"color:white\" href=\"{{this.url}}\">{{this.value}}</a>{{/if}}
      {{#unless this.url}}{{this.key}}{{/unless}}
      </td></tr>
      {{/unless}}
      {{/each}}
      </table>`,
    );

    Util.removeNullFields(table);
    Util.removeNullFields(suffix);

    const context = {
      table: Object.entries(table).map((element) => ({
        key: this.tNew(element[0], lang),
        value: element[1],
      })),
      suffix: this.replaceDefaultItems(suffix).map((element) => ({
        url: element.params?.url ?? null,
        space: element.key === MailKey.SPACE ? this.getSpaceArray(Number.parseInt(element.params.value)) : null,
        style: element.params?.style ?? MailStructurePart.DEFAULT_STYLE,
        key: element.params?.url ? this.tNew(element.key, lang)?.split('[url:')[0] : this.tNew(element.key, lang),
        value: element.params?.url ? this.tNew(element.key, lang)?.split('[url:')[1]?.split(']')[0] : null,
      })),
    };

    return bodyTemplate(context);
  }

  private getSpaceArray(space?: number): string[] {
    return Array.from({ length: space ?? 1 }, () => '');
  }

  private replaceDefaultItems(suffix: TranslationItem[]): TranslationItem[] {
    return suffix.map((element) => (element.params?.default ? this.getDefaultItem(element.key) : element)).flat();
  }

  private getDefaultItem(key: string): TranslationItem[] {
    switch (key) {
      case MailKey.DFX_TEAM_CLOSING:
        return this.getDfxTeamClosing();
    }
  }

  private getDfxTeamClosing(): TranslationItem[] {
    return [
      { key: MailKey.SPACE, params: { value: '2' } },
      { key: `${MailTranslationKey.GENERAL}.dfx_team_closing` },
      { key: MailKey.SPACE, params: { value: '4' } },
      { key: `${MailTranslationKey.GENERAL}.dfx_closing_message`, params: { style: 'Zapfino' } },
    ];
  }
}
