import { GetConfig } from 'src/config/config';
import { NotificationType } from 'src/notification/enums';
import { Notification, NotificationOptions, NotificationMetadata } from '../notification.entity';

export interface MandatoryMailParams {
  to: string;
  subject: string;
  salutation: string;
  body: string;
}

export interface OptionalMailParams {
  from?: { name: string; address: string };
  cc?: string;
  bcc?: string;
  template?: string;
  date?: number;
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  options?: NotificationOptions;
  metadata?: NotificationMetadata;
}

export class Mail extends Notification {
  readonly #from: { name: string; address: string } = {
    name: 'DFX.swiss',
    address: GetConfig().mail.contact.noReplyMail,
  };
  readonly #to: string;
  readonly #cc: string;
  readonly #bcc: string;
  readonly #template: string = GetConfig().mail.defaultMailTemplate;
  readonly #subject: string;
  readonly #salutation: string;
  readonly #body: string;
  readonly #date: number = new Date().getFullYear();
  readonly #telegramUrl: string = GetConfig().defaultTelegramUrl;
  readonly #twitterUrl: string = GetConfig().defaultTwitterUrl;
  readonly #linkedinUrl: string = GetConfig().defaultLinkedinUrl;
  readonly #instagramUrl: string = GetConfig().defaultInstagramUrl;

  constructor(params: MandatoryMailParams, optional?: OptionalMailParams) {
    super();
    this.create(NotificationType.MAIL, optional?.metadata, optional?.options);

    this.#to = params.to;
    this.#subject = params.subject;
    this.#salutation = params.salutation;
    this.#body = params.body;

    this.#from = optional?.from ?? this.#from;
    this.#cc = optional?.cc ?? this.#cc;
    this.#bcc = optional?.bcc ?? this.#bcc;
    this.#template = optional?.template ?? this.#template;
    this.#date = optional?.date ?? this.#date;
    this.#telegramUrl = optional?.telegramUrl ?? this.#telegramUrl;
    this.#twitterUrl = optional?.twitterUrl ?? this.#twitterUrl;
    this.#linkedinUrl = optional?.linkedinUrl ?? this.#linkedinUrl;
    this.#instagramUrl = optional?.instagramUrl ?? this.#instagramUrl;
  }

  get from(): { name: string; address: string } {
    const { name, address } = this.#from;
    return { name, address };
  }

  get to(): string {
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

  get subject(): string {
    return this.#subject;
  }

  get salutation(): string {
    return this.#salutation;
  }

  get body(): string {
    return this.#body;
  }

  get date(): number {
    return this.#date;
  }

  get telegramUrl(): string {
    return this.#telegramUrl;
  }

  get twitterUrl(): string {
    return this.#twitterUrl;
  }

  get linkedinUrl(): string {
    return this.#linkedinUrl;
  }

  get instagramUrl(): string {
    return this.#instagramUrl;
  }
}
