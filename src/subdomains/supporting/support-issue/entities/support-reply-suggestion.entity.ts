import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { SupportReplySuggestionState } from '../enums/support-reply-suggestion.enum';
import { SupportIssue } from './support-issue.entity';
import { SupportMessage } from './support-message.entity';

/**
 * A proposed answer to a support issue, submitted through the API by a suggestion producer and
 * offered to the clerk who works the ticket.
 *
 * Nothing is ever deleted here: a suggestion leaves `Pending` only for a terminal state that says
 * what happened to it (`Accepted`, `Rejected`, or `Superseded` by a newer one). The transition is
 * reconstructible from the row alone — the previous state of a terminal row is always `Pending`,
 * `created` is when it was submitted and `handled` when it left that state — so the state column
 * carries no history that the overwrite could destroy.
 */
@Entity()
export class SupportReplySuggestion extends IEntity {
  @Index()
  @ManyToOne(() => SupportIssue, { nullable: false })
  issue: SupportIssue;

  /**
   * The message the suggestion answers.
   *
   * Always the newest message of the thread at submission time — the service resolves it and
   * rejects a submission that names an older one. A suggestion is therefore never a free-floating
   * answer to the ticket, but an answer to one exact point in the conversation, and a suggestion
   * whose message is no longer the newest is visibly outdated rather than silently wrong.
   */
  @Index()
  @ManyToOne(() => SupportMessage, { nullable: false })
  message: SupportMessage;

  @Column({ type: 'text' })
  text: string;

  @Column({ length: 256, default: SupportReplySuggestionState.PENDING })
  state: SupportReplySuggestionState;

  /** Account (userData id) of the staff member or service that submitted the suggestion. */
  @Column({ type: 'int' })
  authorId: number;

  /** Account (userData id) of the clerk who accepted or rejected it. */
  @Column({ type: 'int', nullable: true })
  handledById?: number;

  @Column({ type: 'timestamp', nullable: true })
  handled?: Date;

  // --- ENTITY METHODS --- //

  setState(state: SupportReplySuggestionState, handledById?: number): UpdateResult<SupportReplySuggestion> {
    const update: Partial<SupportReplySuggestion> = { state, handledById, handled: new Date() };

    Object.assign(this, update);

    return [this.id, update];
  }

  get isPending(): boolean {
    return this.state === SupportReplySuggestionState.PENDING;
  }
}
