import { GetConfig } from 'src/config/config';
import { Notification, NotificationOptions } from '../../notification.entity';

export interface MailParamBase {
  to: string | string[];
  subject: string;
  from?: string;
  displayName?: string;
  cc?: string;
  bcc?: string;
  template?: string;
  walletName?: string;
  options?: NotificationOptions;
  correlationId?: string;
}

export interface MailParams extends MailParamBase {
  templateParams?: {
    salutation: string;
    body: string;
    date?: number;
    banner?: string;
    telegramUrl?: string;
    twitterUrl?: string;
    linkedinUrl?: string;
    instagramUrl?: string;
  };
}

export interface MailParamsNew extends MailParamBase {
  templateParams?: any;
}

export class Mail extends Notification {
  readonly #from: { name: string; address: string };
  readonly #to: string | string[];
  readonly #cc: string;
  readonly #bcc: string;
  readonly #subject: string;
  readonly #template: string;
  readonly #templateParams: { [name: string]: any };
  readonly #walletName?: string;

  constructor(params: MailParams | MailParamsNew) {
    super();

    const walletMailConfig = params.walletName ? GetConfig().mail.wallet[params.walletName] : undefined;

    this.#walletName = params.walletName;
    this.#to = params.to;
    this.#subject = params.subject;
    this.#from = {
      name: params.displayName ?? walletMailConfig?.displayName ?? 'DFX.swiss',
      address: params.from ?? walletMailConfig?.fromAddress ?? GetConfig().mail.contact.noReplyMail,
    };
    this.#cc = params.cc;
    this.#bcc = params.bcc;
    this.#template = params.template ?? GetConfig().mail.defaultMailTemplate;
    this.#templateParams = params.templateParams;
  }

  get from(): { name: string; address: string } {
    const { name, address } = this.#from;
    return { name, address };
  }

  get to(): string | string[] {
    return this.#to;
  }

  get cc(): string {
    return this.#cc;
  }

  get bcc(): string {
    return this.#bcc;
  }

  get template(): string {
    return this.#template;
  }

  get templateParams(): { [name: string]: any } {
    return this.#templateParams;
  }

  get subject(): string {
    return this.#subject;
  }

  get walletName(): string | undefined {
    return this.#walletName;
  }
}
