import { GetConfig } from 'src/config/config';
import { NotificationType } from 'src/notification/enums';
import { Notification, NotificationOptions, NotificationMetadata } from '../notification.entity';

export interface MailParams {
  to: string;
  subject: string;
  salutation: string;
  body: string;
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

  constructor(params: MailParams) {
    super();
    this.create(NotificationType.MAIL, params.metadata, params.options);

    this.#to = params.to;
    this.#subject = params.subject;
    this.#salutation = params.salutation;
    this.#body = params.body;

    this.#from = params.from ?? this.#from;
    this.#cc = params.cc ?? this.#cc;
    this.#bcc = params.bcc ?? this.#bcc;
    this.#template = params.template ?? this.#template;
    this.#date = params.date ?? this.#date;
    this.#telegramUrl = params.telegramUrl ?? this.#telegramUrl;
    this.#twitterUrl = params.twitterUrl ?? this.#twitterUrl;
    this.#linkedinUrl = params.linkedinUrl ?? this.#linkedinUrl;
    this.#instagramUrl = params.instagramUrl ?? this.#instagramUrl;
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
