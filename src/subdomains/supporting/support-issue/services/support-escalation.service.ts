import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { SupportIssueReasonLabelMap, SupportIssueTypeLabelMap } from '../dto/support-issue-label';
import { SupportIssue } from '../entities/support-issue.entity';
import { CustomerAuthor, SupportMessage } from '../entities/support-message.entity';
import { SupportIssueInternalState, SupportIssueType } from '../enums/support-issue.enum';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportMessageRepository } from '../repositories/support-message.repository';

const CHAT_ID_KEY = 'supportEscalationChatId';
const NOTIFIED_KEY = 'supportEscalationNotified';
const LIMIT_NOTIFIED_KEY = 'supportLimitRequestNotified';
// non-terminal states where a customer can be waiting for a reply (OnHold is parked, so excluded);
// the new InProgress/InClarification states must be included or actively-handled tickets silently stop escalating
const OPEN_STATES = [
  SupportIssueInternalState.CREATED,
  SupportIssueInternalState.PENDING,
  SupportIssueInternalState.IN_PROGRESS,
  SupportIssueInternalState.IN_CLARIFICATION,
];

export interface TelegramChat {
  id: number;
  title: string;
}

// minimal shape of the Telegram getUpdates payload — only the fields the binding logic reads
interface TelegramApiChat {
  id: number;
  type: string;
  title?: string;
}

interface TelegramUpdate {
  message?: { chat?: TelegramApiChat };
  my_chat_member?: { chat?: TelegramApiChat; new_chat_member?: { status?: string } };
  channel_post?: { chat?: TelegramApiChat };
}

// the error body Telegram returns on a failed sendMessage — used to self-heal the binding
interface TelegramErrorResponse {
  description?: string;
  parameters?: { migrate_to_chat_id?: number };
}

// membership statuses that mean the bot is now an active member of the group (i.e. was just added)
const JOINED_STATUSES = ['member', 'administrator', 'creator'];

// Telegram error descriptions that mean the bound chat is permanently unreachable (group gone / bot removed)
const UNREACHABLE_CHAT_ERRORS = [
  'chat not found',
  'kicked',
  'not a member',
  'group chat was deleted',
  'bot was blocked',
];

interface LastMessage {
  author?: string;
  date?: Date;
}

@Injectable()
export class SupportEscalationService {
  private readonly logger = new DfxLogger(SupportEscalationService);

  constructor(
    private readonly http: HttpService,
    private readonly settingService: SettingService,
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly messageRepo: SupportMessageRepository,
  ) {}

  // --- Telegram client ---

  private get token(): string | undefined {
    return Config.support.escalation.telegramBotToken;
  }

  private apiUrl(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.token) return;
    try {
      await this.post(chatId, text);
    } catch (e) {
      // a group upgraded to a supergroup gets a new chat id — rebind to it and resend
      const migratedTo = this.telegramError(e)?.parameters?.migrate_to_chat_id;
      if (migratedTo != null) {
        await this.settingService.set(CHAT_ID_KEY, String(migratedTo));
        await this.post(String(migratedTo), text);
        return;
      }
      // the bound group is gone or the bot was removed — drop the binding so an operator rebinds deliberately
      if (this.isChatUnreachable(e)) {
        await this.settingService.set(CHAT_ID_KEY, '');
        this.logger.warn(`Escalation chat ${chatId} is unreachable; cleared the binding (rebind via telegram-bind)`);
      }
      throw e;
    }
  }

  private post(chatId: string, text: string): Promise<unknown> {
    return this.http.post(this.apiUrl('sendMessage'), {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  private telegramError(error: unknown): TelegramErrorResponse | undefined {
    return (error as { response?: { data?: TelegramErrorResponse } })?.response?.data;
  }

  private isChatUnreachable(error: unknown): boolean {
    const description = this.telegramError(error)?.description?.toLowerCase() ?? '';
    return UNREACHABLE_CHAT_ERRORS.some((e) => description.includes(e));
  }

  // Reads recent updates and returns the group/supergroup chats the bot has seen.
  async getGroupChats(): Promise<TelegramChat[]> {
    return this.collectGroupChats(false);
  }

  // Groups the bot was explicitly added to (membership flipped to a joined status). This is the
  // unambiguous "invite the bot to THIS group" signal — unlike merely having seen a chat.
  async getInvitedGroups(): Promise<TelegramChat[]> {
    return this.collectGroupChats(true);
  }

  private async collectGroupChats(invitedOnly: boolean): Promise<TelegramChat[]> {
    if (!this.token) return [];
    const res = await this.http.get<{ result: TelegramUpdate[] }>(this.apiUrl('getUpdates'));
    const chats = new Map<number, string>();
    for (const update of res?.result ?? []) {
      const chat = invitedOnly
        ? JOINED_STATUSES.includes(update.my_chat_member?.new_chat_member?.status ?? '')
          ? update.my_chat_member?.chat
          : undefined
        : (update.message?.chat ?? update.my_chat_member?.chat ?? update.channel_post?.chat);
      if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
        chats.set(chat.id, chat.title ?? String(chat.id));
      }
    }
    return Array.from(chats.entries()).map(([id, title]) => ({ id, title }));
  }

  // Binds the escalation target deliberately: with an explicit chatId (an operator picked it from
  // getGroupChats) we bind exactly that group after confirming the bot can see it. Without one we
  // only auto-bind when a single group has explicitly invited the bot — never an arbitrary chat,
  // so escalation messages (which carry customer PII) can't leak into an unintended group.
  async bindGroupChat(chatId?: number): Promise<TelegramChat | undefined> {
    let target: TelegramChat | undefined;
    if (chatId != null) {
      target = (await this.getGroupChats()).find((c) => c.id === chatId);
      if (!target) {
        this.logger.warn(`Refusing to bind escalation chat ${chatId}: not among the bot's visible groups`);
        return undefined;
      }
    } else {
      const invited = await this.getInvitedGroups();
      if (invited.length !== 1) {
        this.logger.warn(
          `Not auto-binding escalation chat: expected exactly one invited group, found ${invited.length}`,
        );
        return undefined;
      }
      target = invited[0];
    }
    await this.settingService.set(CHAT_ID_KEY, String(target.id));
    return target;
  }

  async getBoundChatId(): Promise<string | undefined> {
    return this.settingService.get(CHAT_ID_KEY);
  }

  async sendTestMessage(): Promise<boolean> {
    const chatId = await this.getBoundChatId();
    if (!chatId) return false;
    await this.sendMessage(chatId, '✅ <b>DFX Support</b> — Eskalations-Benachrichtigungen sind aktiv.');
    return true;
  }

  // --- Escalation detection ---

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.SUPPORT_BOT, timeout: 1800 })
  async checkEscalations(): Promise<void> {
    if (!this.token) return;

    // only escalate to a chat an operator deliberately bound (POST escalation/telegram-bind); the cron
    // never auto-binds, so customer-PII alerts can't be routed to an unintended group
    const chatId = await this.getBoundChatId();
    if (!chatId) return;

    const threshold = new Date(Date.now() - Config.support.escalation.slaHours * 60 * 60 * 1000);

    const issues = await this.supportIssueRepo.find({ where: { state: In(OPEN_STATES) }, loadEagerRelations: false });
    if (!issues.length) return;

    const lastMessages = await this.getLastMessages(issues.map((i) => i.id));
    const notified = await this.settingService.getObj<Record<string, string>>(NOTIFIED_KEY, {});
    const next: Record<string, string> = {};

    for (const issue of issues) {
      const last = lastMessages.get(issue.id);
      // escalated = customer wrote last and has been waiting beyond the SLA
      if (!last?.date || last.author !== CustomerAuthor || last.date > threshold) continue;

      // the customer message defines the escalation cycle; re-notify only on a newer message
      const cycle = last.date.toISOString();
      if (notified[issue.id] === cycle) {
        next[issue.id] = cycle; // already notified for this cycle, keep the marker
        continue;
      }

      try {
        await this.sendMessage(chatId, this.buildMessage(issue, last.date));
        next[issue.id] = cycle; // mark only after a successful push, so failures retry next run
      } catch (e) {
        this.logger.error(`Failed to push escalation for support issue ${issue.id}:`, e);
      }
    }

    await this.settingService.setObj(NOTIFIED_KEY, next);

    await this.notifyNewLimitRequests(chatId, issues);
  }

  // one-off alert per new open limit increase request
  private async notifyNewLimitRequests(chatId: string, issues: SupportIssue[]): Promise<void> {
    const notified = await this.settingService.getObj<number[]>(LIMIT_NOTIFIED_KEY, []);
    const next: number[] = [];
    for (const issue of issues) {
      if (issue.type !== SupportIssueType.LIMIT_REQUEST) continue;
      if (notified.includes(issue.id)) {
        next.push(issue.id); // already notified, keep the marker
        continue;
      }
      try {
        await this.sendMessage(chatId, this.buildLimitRequestMessage(issue));
        next.push(issue.id); // mark only after a successful push
      } catch (e) {
        this.logger.error(`Failed to push limit request ${issue.id}:`, e);
      }
    }
    await this.settingService.setObj(LIMIT_NOTIFIED_KEY, next);
  }

  private ticketLink(issue: SupportIssue): string | undefined {
    return Config.frontend.services ? `${Config.frontend.services}/support/dashboard/issue/${issue.id}` : undefined;
  }

  private buildLimitRequestMessage(issue: SupportIssue): string {
    const link = this.ticketLink(issue);
    const lines = [
      '📈 <b>Neuer Limit-Antrag</b>',
      `Kunde: ${this.escape(issue.name)}`,
      `Bearbeiter: ${issue.clerk ? this.escape(issue.clerk) : 'Nicht zugewiesen'}`,
    ];
    if (link) lines.push(`<a href="${link}">Ticket öffnen</a>`);
    return lines.join('\n');
  }

  private buildMessage(issue: SupportIssue, waitingSince: Date): string {
    const hours = (Date.now() - waitingSince.getTime()) / (60 * 60 * 1000);
    const waited = hours < 24 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
    const link = this.ticketLink(issue);

    const type = SupportIssueTypeLabelMap[issue.type] ?? issue.type;
    const reason = SupportIssueReasonLabelMap[issue.reason] ?? issue.reason;
    const lines = [
      '🚨 <b>Ticket eskaliert</b>',
      `Kunde: ${this.escape(issue.name)}`,
      `Anliegen: ${type} · ${reason}`,
      `Bearbeiter: ${issue.clerk ? this.escape(issue.clerk) : 'Nicht zugewiesen'}`,
      `Wartet seit ${waited} auf Antwort`,
    ];
    if (link) lines.push(`<a href="${link}">Ticket öffnen</a>`);
    return lines.join('\n');
  }

  private escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private async getLastMessages(issueIds: number[]): Promise<Map<number, LastMessage>> {
    if (issueIds.length === 0) return new Map();

    const rows = await Util.doInBatchesAndJoin(
      issueIds,
      (chunk): Promise<{ issueId: string; lastDate: Date | null; lastAuthor: string | null }[]> =>
        this.messageRepo
          .createQueryBuilder('m')
          .select('m.issueId', 'issueId')
          .addSelect(
            (sub) =>
              sub
                .select('m2.created')
                .from(SupportMessage, 'm2')
                .where('m2.issueId = m.issueId')
                .orderBy('m2.id', 'DESC')
                .limit(1),
            'lastDate',
          )
          .addSelect(
            (sub) =>
              sub
                .select('m2.author')
                .from(SupportMessage, 'm2')
                .where('m2.issueId = m.issueId')
                .orderBy('m2.id', 'DESC')
                .limit(1),
            'lastAuthor',
          )
          .where('m.issueId IN (:...ids)', { ids: chunk })
          .groupBy('m.issueId')
          .getRawMany(),
      1000,
    );

    return new Map(rows.map((r) => [+r.issueId, { author: r.lastAuthor ?? undefined, date: r.lastDate ?? undefined }]));
  }
}
