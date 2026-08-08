import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { SupportReplySuggestionState } from '../enums/support-reply-suggestion.enum';
import { SupportIssue } from './support-issue.entity';

export const CustomerAuthor = 'Customer';
export const AutoResponder = 'AutoResponder';

@Entity()
export class SupportMessage extends IEntity {
  @Column({ length: 256 })
  author: string;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ length: 256, nullable: true })
  fileUrl?: string;

  @Index()
  @ManyToOne(() => SupportIssue, (issue) => issue.messages, { nullable: false, eager: true })
  issue: SupportIssue;

  // --- REPLY SUGGESTION --- //
  //
  // A proposed answer to this message, submitted through the API by a suggestion producer and
  // offered to the clerk who works the ticket. It lives on the message it answers rather than in a
  // table of its own: a suggestion is always an answer to one exact point of the conversation, and
  // at most one is ever proposed per message, so the row that carries the question carries the
  // proposed answer with it. "Only the newest suggestion is offered" then needs no bookkeeping —
  // it is the one on the newest message that has one.
  //
  // Never overwritten: a suggestion leaves `Pending` only for a state that says what happened to it,
  // and a second submission for a message that already carries one is refused rather than replacing
  // it. The fields stay null on every message nobody proposed an answer to, which is most of them.

  @Column({ type: 'text', nullable: true })
  suggestionText?: string;

  @Column({ length: 256, nullable: true })
  suggestionState?: SupportReplySuggestionState;

  /** Account (userData id) of the staff member or service that submitted the suggestion. */
  @Column({ type: 'int', nullable: true })
  suggestionAuthorId?: number;

  /**
   * When the suggestion was submitted. Its own column rather than the row's `updated`, which moves
   * again as soon as the suggestion is decided.
   */
  @Column({ type: 'timestamp', nullable: true })
  suggestionCreated?: Date;

  /** Account (userData id) of the clerk who accepted or rejected it. */
  @Column({ type: 'int', nullable: true })
  suggestionHandledById?: number;

  @Column({ type: 'timestamp', nullable: true })
  suggestionHandled?: Date;

  // --- ENTITY METHODS --- //

  setSuggestion(text: string, authorId: number, created: Date): UpdateResult<SupportMessage> {
    const update: Partial<SupportMessage> = {
      suggestionText: text,
      suggestionState: SupportReplySuggestionState.PENDING,
      suggestionAuthorId: authorId,
      suggestionCreated: created,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  decideSuggestion(state: SupportReplySuggestionState, handledById: number): UpdateResult<SupportMessage> {
    const update: Partial<SupportMessage> = {
      suggestionState: state,
      suggestionHandledById: handledById,
      suggestionHandled: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get hasSuggestion(): boolean {
    return this.suggestionText != null;
  }

  get userData(): UserData {
    return this.issue.userData;
  }

  get fileName(): string {
    const fileName = this.fileUrl?.split('/').pop();
    return fileName ? decodeURIComponent(fileName) : undefined;
  }
}
