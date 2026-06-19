import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { HttpService } from 'src/shared/services/http.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { SupportIssueReasonLabelDe, SupportIssueTypeLabelDe } from '../dto/support-issue-label';
import { SupportIssue } from '../entities/support-issue.entity';
import { CustomerAuthor, SupportMessage } from '../entities/support-message.entity';
import { SupportIssueInternalState, SupportIssueType } from '../enums/support-issue.enum';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportMessageRepository } from '../repositories/support-message.repository';

const CHAT_ID_KEY = 'supportEscalationChatId';
const NOTIFIED_KEY = 'supportEscalationNotified';
const LIMIT_NOTIFIED_KEY = 'supportLimitRequestNotified';
const OPEN_STATES = [SupportIssueInternalState.CREATED, SupportIssueInternalState.PENDING];

export interface TelegramChat {
  id: number;
  title: string;
}

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
    await this.http.post(this.apiUrl('sendMessage'), {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  // Reads recent updates and returns the group/supergroup chats the bot has seen.
  async getGroupChats(): Promise<TelegramChat[]> {
    if (!this.token) return [];
    const res = await this.http.get<{ result: any[] }>(this.apiUrl('getUpdates'));
    const chats = new Map<number, string>();
    for (const update of res?.result ?? []) {
      const chat = update.message?.chat ?? update.my_chat_member?.chat ?? update.channel_post?.chat;
      if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
        chats.set(chat.id, chat.title ?? String(chat.id));
      }
    }
    return Array.from(chats.entries()).map(([id, title]) => ({ id, title }));
  }

  // Convenience: pick the most recently seen group and store it as the escalation target.
  async bindGroupChat(): Promise<TelegramChat | undefined> {
    const chats = await this.getGroupChats();
    const target = chats[chats.length - 1];
    if (target) await this.settingService.set(CHAT_ID_KEY, String(target.id));
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

    // auto-discover the target group from the "bot added to group" event, so it works
    // by simply inviting the bot — no manual binding step required
    let chatId = await this.settingService.get(CHAT_ID_KEY);
    if (!chatId) {
      const bound = await this.bindGroupChat();
      chatId = bound && String(bound.id);
    }
    if (!chatId) return;

    const threshold = new Date(Date.now() - Config.support.escalation.slaHours * 60 * 60 * 1000);

    const issues = await this.supportIssueRepo.find({ where: { state: In(OPEN_STATES) }, loadEagerRelations: false });
    if (!issues.length) return;

    const lastMessages = await this.getLastMessages(issues.map((i) => i.id));
    const notified = (await this.settingService.getObj<Record<string, string>>(NOTIFIED_KEY)) ?? {};
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
    const notified = (await this.settingService.getObj<number[]>(LIMIT_NOTIFIED_KEY)) ?? [];
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

  private buildLimitRequestMessage(issue: SupportIssue): string {
    const link = Config.frontend.services
      ? `${Config.frontend.services}/support/dashboard/issue/${issue.id}`
      : undefined;
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
    const link = Config.frontend.services
      ? `${Config.frontend.services}/support/dashboard/issue/${issue.id}`
      : undefined;

    const type = SupportIssueTypeLabelDe[issue.type] ?? issue.type;
    const reason = SupportIssueReasonLabelDe[issue.reason] ?? issue.reason;
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
