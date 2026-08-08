import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import {
  FIAT_REPUBLIC_PAYMENT_FAILED_STATES,
  FIAT_REPUBLIC_PAYMENT_TERMINAL_STATES,
  FiatRepublicMatchLevel,
  FiatRepublicPaymentResponse,
  FiatRepublicPaymentScheme,
  FiatRepublicPaymentStatus,
} from 'src/integration/bank/dto/fiat-republic.dto';
import { FiatRepublicEndUserService } from 'src/integration/bank/services/fiat-republic-end-user.service';
import { FiatRepublicPayeeService } from 'src/integration/bank/services/fiat-republic-payee.service';
import { FiatRepublicNotFoundError, FiatRepublicService } from 'src/integration/bank/services/fiat-republic.service';
import { IbanService } from 'src/integration/bank/services/iban.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { IbanBankName } from '../bank/bank/dto/bank.dto';
import { VirtualIbanService } from '../bank/virtual-iban/virtual-iban.service';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

/** SEPA references may be 140 characters; Fiat Republic requires at least 6 alphanumerics. */
const MAX_REFERENCE_LENGTH = 140;
/** How far back the recovery lookup searches for a payment whose create outcome is unknown. */
const RECOVERY_LOOKUP_OVERLAP_DAYS = 2;

/** Where a payout leaves from: the customer's own named sub-account, or DFX's master account. */
interface FiatRepublicPayoutSource {
  fromId: string;
  endUserId?: string;
}

@Injectable()
export class FiatOutputFiatRepublicService {
  private readonly logger = new DfxLogger(FiatOutputFiatRepublicService);

  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly fiatRepublicService: FiatRepublicService,
    private readonly payeeService: FiatRepublicPayeeService,
    private readonly endUserService: FiatRepublicEndUserService,
    private readonly virtualIbanService: VirtualIbanService,
    private readonly ibanService: IbanService,
  ) {}

  /**
   * Stage 3 of the Fiat Republic rollout: transmit fiat outputs that are already assigned to Fiat
   * Republic. Deliberately does not select or re-route anything — which bank a payout belongs to is
   * decided in `FiatOutputService.selectPayoutBank` under its own separate flag.
   */
  async transmitPayments(): Promise<void> {
    if (!this.canCreatePayments()) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        isReadyDate: Not(IsNull()),
        isTransmittedDate: IsNull(),
        fiatRepublicCustomId: IsNull(),
        isComplete: false,
        bank: { name: IbanBankName.FIAT_REPUBLIC },
      },
    });

    for (const entity of entities) {
      try {
        await this.transmitPayment(entity);
      } catch (error) {
        this.logger.error(`Failed to transmit Fiat Republic payment for fiat output ${entity.id}:`, error);
        await this.fiatOutputRepo.update(entity.id, {
          fiatRepublicError: this.toErrorText(error),
        });
      }
    }
  }

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.WORKER, process: Process.FIAT_OUTPUT, timeout: 1800 })
  async checkFiatRepublicPaymentStatus(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_FIAT_REPUBLIC_STATUS_CHECK)) return;
    if (!this.fiatRepublicService.isPayoutEnabled()) return;

    const statusRequest: FindOptionsWhere<FiatOutput> = { fiatRepublicCustomId: Not(IsNull()), isComplete: false };
    const entities = await this.fiatOutputRepo.find({
      where: [
        { ...statusRequest, fiatRepublicPaymentStatus: IsNull() },
        { ...statusRequest, fiatRepublicPaymentStatus: Not(In(FIAT_REPUBLIC_PAYMENT_TERMINAL_STATES)) },
      ],
    });

    for (const entity of entities) {
      try {
        await this.checkPayment(entity);
      } catch (error) {
        this.logger.error(`Failed to check Fiat Republic payment status for fiat output ${entity.id}:`, error);
        await this.fiatOutputRepo.update(entity.id, {
          fiatRepublicError: this.toErrorText(error, 'status'),
        });
      }
    }
  }

  /**
   * Both required conditions in one place, mirroring the Bank Frick gate: the runtime kill switch
   * (settable without a deploy) and the environment release (credentials + master flag + payout
   * stage). Also consulted by the liquidity reservation, so a payout is never marked ready for a
   * rail that cannot currently send.
   */
  canCreatePayments(): boolean {
    return (
      !DisabledProcess(Process.FIAT_OUTPUT_FIAT_REPUBLIC_TRANSMISSION) && this.fiatRepublicService.isPayoutEnabled()
    );
  }

  isTerminalState(status: FiatRepublicPaymentStatus | undefined): boolean {
    return status !== undefined && FIAT_REPUBLIC_PAYMENT_TERMINAL_STATES.includes(status);
  }

  // --- TRANSMISSION --- //

  private async transmitPayment(entity: FiatOutput): Promise<void> {
    const customId = this.customId(entity);
    const reference = this.createUniqueReference(customId, entity.remittanceInfo);

    // Everything before the reservation is either a pure computation or an idempotent lookup with no
    // money effect. A data problem here (missing IBAN, unresolvable BIC, payee not active yet) must
    // leave fiatRepublicCustomId untouched so the next tick retries cleanly.
    const source = await this.resolvePayoutSource(entity);
    const payeeId = await this.payeeService.getOrCreatePayee({
      endUserId: source.endUserId,
      name: entity.name,
      iban: entity.iban,
      bic: await this.resolveCreditorBic(entity),
      address: {
        line1: [entity.address, entity.houseNumber].filter(Boolean).join(' '),
        city: entity.city,
        postalCode: entity.zip,
        country: entity.country,
      },
    });

    // Reserve the row atomically immediately before the money-moving call. customId is deterministic,
    // so re-setting it on a legitimate retry is inherently idempotent — the WHERE clause is what makes
    // this a mutex: a concurrent tick sees affected=0 and skips, so at most one caller ever reaches
    // createPayment for this row. fiatRepublicReference is written in the same atomic statement
    // because reconciliation matches on it: if it only landed after the payment existed at Fiat
    // Republic, a crash in between would strand the row permanently unmatched.
    const reserved = await this.fiatOutputRepo.update(
      { id: entity.id, fiatRepublicCustomId: IsNull() },
      { fiatRepublicCustomId: customId, fiatRepublicReference: reference },
    );
    if (reserved.affected !== 1) return;

    // Single-use and valid for ten minutes — created here, immediately before the payment, never cached.
    const { verificationId, matchLevel } = await this.payeeService.createVerification(payeeId);

    const payment = await this.fiatRepublicService.createPayment(
      {
        fromId: source.fromId,
        toId: payeeId,
        amount: this.toAmount(entity.amount),
        reference,
        paymentScheme: FiatRepublicPaymentScheme.SCT,
        payeeVerificationId: verificationId,
      },
      customId,
    );

    await this.fiatOutputRepo.update(entity.id, {
      fiatRepublicPaymentId: payment.id,
      fiatRepublicMatchLevel: matchLevel,
      ...(!entity.remittanceInfo && { remittanceInfo: `DFX Payout ${entity.id}` }),
      isTransmittedDate: new Date(),
      ...this.getStatusUpdate(payment, entity),
    });

    if (matchLevel !== FiatRepublicMatchLevel.MATCH)
      this.logger.info(
        `Fiat Republic payout ${entity.id} was sent after an accepted ${matchLevel} verification of payee`,
      );
  }

  // --- STATUS --- //

  private async checkPayment(entity: FiatOutput): Promise<void> {
    const payment = await this.resolvePayment(entity);
    if (!payment) return;

    // Defence in depth for the two-write transmission path: a payment that exists at Fiat Republic
    // proves the create landed, so heal the local bookkeeping instead of leaving the row unmatched.
    const gapHeal: Partial<FiatOutput> = {
      ...(!entity.isTransmittedDate && { isTransmittedDate: new Date() }),
      ...(!entity.fiatRepublicPaymentId && { fiatRepublicPaymentId: payment.id }),
    };

    const updateData = { ...gapHeal, ...this.getStatusUpdate(payment, entity) };
    if (Object.keys(updateData).length > 0) await this.fiatOutputRepo.update(entity.id, updateData);
  }

  /**
   * Resolves the Fiat Republic payment for a reserved row. When the payment id is already known this
   * is a direct read; otherwise the reference lookup decides between "the create never landed"
   * (release the claim, so transmission can retry with the same deterministic id) and "it did"
   * (adopt it). A lookup that could not complete propagates — it must never be read as absence.
   */
  private async resolvePayment(entity: FiatOutput): Promise<FiatRepublicPaymentResponse | undefined> {
    if (entity.fiatRepublicPaymentId) {
      try {
        return await this.fiatRepublicService.getPayment(entity.fiatRepublicPaymentId);
      } catch (error) {
        if (error instanceof FiatRepublicNotFoundError && !entity.isTransmittedDate) {
          await this.releaseClaim(entity);
          return undefined;
        }
        throw error;
      }
    }

    const fromDate = Util.daysBefore(RECOVERY_LOOKUP_OVERLAP_DAYS, entity.isReadyDate ?? entity.created);
    const found = await this.fiatRepublicService.findPaymentByReference(
      entity.fiatRepublicReference ?? this.customId(entity),
      fromDate,
      new Date(),
    );
    if (found) return found;

    if (!entity.isTransmittedDate) {
      await this.releaseClaim(entity);
      return undefined;
    }

    // Transmitted on our side but not findable at Fiat Republic — never silently release that claim.
    this.logger.error(`Fiat Republic payout ${entity.id} is marked transmitted but no matching payment was found`);
    return undefined;
  }

  /**
   * Releases the transmission claim so the minutely job can retry. Conditional, not by id alone: this
   * entity snapshot can be stale by the time the write runs (the transmission job may have reserved
   * and sent this very row in between), so the WHERE clause re-checks that the row is still in
   * exactly the state this branch observed — otherwise it is a no-op.
   */
  private async releaseClaim(entity: FiatOutput): Promise<void> {
    await this.fiatOutputRepo.update(
      { id: entity.id, fiatRepublicCustomId: entity.fiatRepublicCustomId, isTransmittedDate: IsNull() },
      { fiatRepublicCustomId: null, fiatRepublicPaymentId: null, fiatRepublicError: null },
    );
  }

  private getStatusUpdate(payment: FiatRepublicPaymentResponse, entity: FiatOutput): Partial<FiatOutput> {
    const now = new Date();

    switch (payment.status) {
      case FiatRepublicPaymentStatus.CREATED:
      case FiatRepublicPaymentStatus.PROCESSING:
        return { fiatRepublicPaymentStatus: payment.status, fiatRepublicError: null };

      // Held for a human decision — non-terminal, so the liquidity stays reserved, but the row must
      // show why nothing is moving.
      case FiatRepublicPaymentStatus.AWAITING_APPROVAL:
      case FiatRepublicPaymentStatus.MEMBER_REVIEW:
      case FiatRepublicPaymentStatus.COMPLIANCE_REVIEW:
        return {
          fiatRepublicPaymentStatus: payment.status,
          fiatRepublicError: entity.fiatRepublicError ?? `Fiat Republic payment is in ${payment.status}`,
        };

      case FiatRepublicPaymentStatus.COMPLETED:
        return {
          fiatRepublicPaymentStatus: payment.status,
          fiatRepublicError: null,
          ...(!entity.isApprovedDate && { isApprovedDate: now }),
          ...(!entity.isConfirmedDate && { isConfirmedDate: now }),
        };

      default:
        // Terminal and unpaid: keep the reason instead of erasing it — an operator (and the stuck
        // fiat output monitor) has to be able to see why this payout never completed.
        if (FIAT_REPUBLIC_PAYMENT_FAILED_STATES.includes(payment.status))
          return {
            fiatRepublicPaymentStatus: payment.status,
            fiatRepublicError: entity.fiatRepublicError ?? `Fiat Republic payment ${payment.status}`,
          };

        throw new Error(`Unsupported Fiat Republic payment status ${payment.status}`);
    }
  }

  // --- HELPER METHODS --- //

  private customId(entity: FiatOutput): string {
    return `DFX-FO-${entity.id}`;
  }

  /** Fiat Republic expects amounts as a string with two decimals. */
  private toAmount(amount: number): string {
    return Util.round(amount, 2).toFixed(2);
  }

  private createUniqueReference(customId: string, requestedReference?: string): string {
    const normalizedReference = requestedReference?.trim();
    if (!normalizedReference || normalizedReference === customId) return customId;
    return Array.from(`${customId} ${normalizedReference}`).slice(0, MAX_REFERENCE_LENGTH).join('');
  }

  /**
   * A payout leaves from the customer's own named sub-account when they have one — that is what keeps
   * every movement of one customer visible under one Fiat Republic identity, which is what the payin
   * side and the AUP reporting rely on. Without one it leaves from DFX's master account.
   */
  private async resolvePayoutSource(entity: FiatOutput): Promise<FiatRepublicPayoutSource> {
    const masterFiatAccountId = Config.bank.fiatRepublic.masterFiatAccountId;
    if (!masterFiatAccountId) throw new Error('Fiat Republic master fiat account is not configured');

    if (entity.accountIban) {
      const virtualIban = await this.virtualIbanService.getByIban(entity.accountIban);
      if (virtualIban?.bank?.name === IbanBankName.FIAT_REPUBLIC && virtualIban.providerAccountRef) {
        const endUserId = virtualIban.userData
          ? await this.endUserService.findEndUserId(virtualIban.userData.id)
          : undefined;
        return { fromId: virtualIban.providerAccountRef, endUserId };
      }
    }

    return { fromId: masterFiatAccountId };
  }

  /**
   * SEPA payees require a BIC. Resolve it from the IBAN when the row does not carry one, failing
   * closed on an ambiguous result rather than guessing a routing destination.
   */
  private async resolveCreditorBic(entity: FiatOutput): Promise<string> {
    if (entity.bic) return entity.bic;
    if (!entity.iban) throw new Error('Fiat Republic payout requires a creditor IBAN');

    const details = await this.ibanService.getIbanInfos(entity.iban);
    const candidates = [...(details.bic_candidates ?? []), ...(details.all_bic_candidates ?? [])]
      .map(({ bic }) => bic?.replace(/\s/g, '').toUpperCase())
      .filter((bic): bic is string => !!bic);
    const uniqueCandidates = [...new Set(candidates)];

    if (uniqueCandidates.length !== 1)
      throw new Error(
        uniqueCandidates.length === 0
          ? 'Unable to resolve creditor BIC for Fiat Republic payout'
          : 'Ambiguous creditor BIC for Fiat Republic payout',
      );

    return uniqueCandidates[0];
  }

  /** Fixed, bounded text — upstream messages are already classified and carry no payload. */
  private toErrorText(error: unknown, kind: 'payment' | 'status' = 'payment'): string {
    const message = error instanceof Error ? error.message : 'unknown error';
    return `FIAT REPUBLIC ${kind} error: ${message}`.substring(0, 256);
  }
}
