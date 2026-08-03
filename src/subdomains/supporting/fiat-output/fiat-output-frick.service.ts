import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import {
  FRICK_TERMINAL_STATES,
  FrickPaymentCharge,
  FrickPaymentOrder,
  FrickPaymentOrderNotFoundError,
  FrickPaymentState,
} from 'src/integration/bank/dto/frick.dto';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { IbanService } from 'src/integration/bank/services/iban.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { IbanBankName } from '../bank/bank/dto/bank.dto';
import { FiatOutput, TransactionCharge } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputFrickService {
  private readonly logger = new DfxLogger(FiatOutputFrickService);

  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly frickService: BankFrickService,
    private readonly ibanService: IbanService,
  ) {}

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.WORKER, process: Process.FIAT_OUTPUT, timeout: 1800 })
  async checkFrickOrderStatus(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_FRICK_STATUS_CHECK)) return;
    if (!this.frickService.isAvailable()) return;

    const statusRequest: FindOptionsWhere<FiatOutput> = { frickCustomId: Not(IsNull()), isComplete: false };
    const entities = await this.fiatOutputRepo.find({
      where: [
        { ...statusRequest, frickOrderStatus: IsNull() },
        { ...statusRequest, frickOrderStatus: Not(In(FRICK_TERMINAL_STATES)) },
      ],
    });

    for (const entity of entities) {
      try {
        let order: FrickPaymentOrder;
        try {
          order = await this.frickService.getPaymentOrder(entity.frickCustomId);
        } catch (error) {
          if (error instanceof FrickPaymentOrderNotFoundError && !entity.isTransmittedDate) {
            // The lookup searches Bank Frick's full history (never a narrow recent window), so "not
            // found" is reliable evidence the PUT that reserved this customId never actually reached
            // (or was never accepted by) Bank Frick. Release the claim so transmitPayments can safely
            // retry with the same, still-deterministic customId - its own idempotent lookup-before-PUT
            // then either finds the order after all or creates it fresh.
            // Conditional, not unconditional-by-id: this snapshot's `entity.isTransmittedDate` can be
            // stale by the time this write runs (the minutely transmitPayments may have reserved and
            // transmitted this very row in between). Re-checking frickCustomId + isTransmittedDate IS
            // NULL against the live row means the clear only takes effect if the row is still in exactly
            // the state this branch observed - otherwise it's a no-op and the concurrent reservation
            // stays visible to this status poller.
            await this.fiatOutputRepo.update(
              { id: entity.id, frickCustomId: entity.frickCustomId, isTransmittedDate: IsNull() },
              { frickCustomId: null, frickError: null },
            );
            continue;
          }
          throw error;
        }

        if (order.state === FrickPaymentState.PREPARED && this.isFrickAutomaticApprovalEnabled()) {
          order = await this.frickService.approvePaymentWithoutTan(order);
        }

        // Defense-in-depth for the atomic reserve+transmit write in transmitPayments: an order being
        // found here proves it was actually created at Bank Frick, so if isTransmittedDate/frickReference
        // are still missing on our side (a crash/DB blip hit between transmitPayments' two writes), heal
        // them here instead of leaving the row permanently unmatched by reconciliation.
        const reservationGapHeal: Partial<FiatOutput> = {
          ...(!entity.isTransmittedDate && { isTransmittedDate: new Date() }),
          ...(!entity.frickReference && {
            frickReference: this.createUniqueReference(entity.frickCustomId, entity.remittanceInfo),
          }),
        };

        const updateData = { ...reservationGapHeal, ...this.getFrickStatusUpdate(order, entity) };
        if (Object.keys(updateData).length > 0) await this.fiatOutputRepo.update(entity.id, updateData);
      } catch (error) {
        this.logger.error(`Failed to check Bank Frick order status for fiat output ${entity.id}:`, error);
        const message = error instanceof Error ? error.message : 'unknown error';
        await this.fiatOutputRepo.update(entity.id, {
          frickError: `FRICK status error: ${message}`.substring(0, 256),
        });
      }
    }
  }

  async transmitPayments(): Promise<void> {
    if (!this.canCreatePayments()) return;

    const entities = await this.fiatOutputRepo.find({
      where: {
        isReadyDate: Not(IsNull()),
        isTransmittedDate: IsNull(),
        frickCustomId: IsNull(),
        isComplete: false,
        bank: { name: IbanBankName.FRICK },
      },
    });

    for (const entity of entities) {
      try {
        const customId = `DFX-FO-${entity.id}`;
        // The exact, bank-bound reference sent to Bank Frick - kept in its own column (frickReference)
        // rather than overwriting the customer-facing remittanceInfo, which chain report history reads
        // verbatim and must never be retroactively rewritten.
        const frickReference = this.createUniqueReference(customId, entity.remittanceInfo);
        const address = entity.address ? [entity.address, entity.houseNumber].filter(Boolean).join(' ') : undefined;
        // Pre-flight computation only (no Bank Frick HTTP call yet): a data problem here (e.g. no
        // unique creditor BIC) must not touch frickCustomId, so it keeps retrying every minute via this
        // same method instead of only every hour via the status poller's self-heal.
        const creditorBic = await this.resolveCreditorBic(entity);
        // CHF (Bank Frick FOREIGN) requires some charge value - SHA is the documented default when the
        // business never set one. Persisted onto the entity below instead of staying a NULL that looks
        // unset, so the actual decision is durable and visible on the row, not just implicit in code.
        const outputCharge = entity.currency === 'CHF' ? (entity.charge ?? TransactionCharge.SHA) : entity.charge;
        const charge = outputCharge
          ? {
              [TransactionCharge.BEN]: FrickPaymentCharge.BENEFICIARY,
              [TransactionCharge.OUR]: FrickPaymentCharge.OUR,
              [TransactionCharge.SHA]: FrickPaymentCharge.SHARED,
            }[outputCharge]
          : undefined;

        // Reserve this row atomically immediately before the actual Bank Frick call. customId is
        // deterministic (derived only from entity.id), so re-setting it to the same value on a
        // legitimate retry is inherently idempotent - the WHERE clause is what turns this into a
        // mutex: a concurrent tick (an overlapping cron window, or a second instance) sees affected=0
        // and skips, so at most one caller ever reaches createPaymentOrder for this row. frickReference
        // is folded into this same atomic write (not deferred to the post-createPaymentOrder update
        // below): it's already fully computed and is required for reconciliation
        // (getMatchingBankTx uses frickReference ?? remittanceInfo) - if it only landed after the order
        // was created at Bank Frick, a crash/DB blip between the two writes would leave the order live
        // at the bank but frickReference NULL on our side, permanently stranding reconciliation.
        const reserved = await this.fiatOutputRepo.update(
          { id: entity.id, frickCustomId: IsNull() },
          { frickCustomId: customId, frickReference },
        );
        if (reserved.affected !== 1) continue;

        const order = await this.frickService.createPaymentOrder({
          customId,
          amount: entity.amount,
          currency: entity.currency as 'CHF' | 'EUR',
          instant: entity.isInstant,
          reference: frickReference,
          charge,
          debtorIban: entity.accountIban,
          creditor: {
            name: entity.name,
            iban: entity.iban,
            bic: creditorBic,
            address,
            postalcode: entity.zip,
            city: entity.city,
            country: entity.country,
            creditInstitution: entity.creditInstitution,
          },
        });
        const safeOrderId = this.frickService.getSafeOrderId(order);

        // frickCustomId and frickReference are already durably reserved above. Persist the rest of the
        // bank-side identity before any optional approval call - if approval fails, the status job
        // continues with the stable customId and never creates another payment order. remittanceInfo is
        // only ever filled when the business never set one at all (matching the Yapeal/Olkypay fallback
        // pattern) - never overwritten with the bank-bound reference.
        await this.fiatOutputRepo.update(entity.id, {
          ...(safeOrderId && { frickOrderId: safeOrderId }),
          charge: outputCharge,
          ...(!entity.remittanceInfo && { remittanceInfo: `DFX Payout ${entity.id}` }),
          isTransmittedDate: new Date(),
          ...this.getFrickStatusUpdate(order, entity),
        });

        if (this.isFrickAutomaticApprovalEnabled() && order.state === FrickPaymentState.PREPARED) {
          const approvedOrder = await this.frickService.approvePaymentWithoutTan(order);
          const updateData = this.getFrickStatusUpdate(approvedOrder, entity);
          if (Object.keys(updateData).length > 0) await this.fiatOutputRepo.update(entity.id, updateData);
        }
      } catch (error) {
        this.logger.error(`Failed to transmit Bank Frick payment for fiat output ${entity.id}:`, error);
        const message = error instanceof Error ? error.message : 'unknown error';
        await this.fiatOutputRepo.update(entity.id, {
          frickError: `FRICK error: ${message}`.substring(0, 256),
        });
      }
    }
  }

  isFrickTerminalState(status: FrickPaymentState | undefined): boolean {
    return status !== undefined && FRICK_TERMINAL_STATES.includes(status);
  }

  canCreatePayments(): boolean {
    return (
      !DisabledProcess(Process.FIAT_OUTPUT_FRICK_TRANSMISSION) &&
      Config.bank.frick.payoutEnabled &&
      this.frickService.isAvailable()
    );
  }

  private createUniqueReference(customId: string, requestedReference?: string): string {
    const normalizedReference = requestedReference?.trim();
    if (!normalizedReference || normalizedReference === customId) return customId;
    return Array.from(`${customId} ${normalizedReference}`).slice(0, 140).join('');
  }

  private async resolveCreditorBic(entity: FiatOutput): Promise<string | undefined> {
    if (entity.currency !== 'CHF' || entity.bic) return entity.bic;
    if (!entity.iban) throw new Error('Bank Frick CHF payout requires creditor IBAN for BIC resolution');

    const details = await this.ibanService.getIbanInfos(entity.iban);
    const candidates = [...(details.bic_candidates ?? []), ...(details.all_bic_candidates ?? [])]
      .map(({ bic }) => bic?.replace(/\s/g, '').toUpperCase())
      .filter((bic): bic is string => !!bic);
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length !== 1)
      throw new Error(
        uniqueCandidates.length === 0
          ? 'Unable to resolve creditor BIC for Bank Frick CHF payout'
          : 'Ambiguous creditor BIC for Bank Frick CHF payout',
      );
    return uniqueCandidates[0];
  }

  private getFrickStatusUpdate(order: FrickPaymentOrder, entity: FiatOutput): Partial<FiatOutput> {
    const now = new Date();

    switch (order.state) {
      case FrickPaymentState.IN_PROGRESS:
      case FrickPaymentState.EXECUTED:
        return {
          frickOrderStatus: order.state,
          frickError: null,
          ...(!entity.isApprovedDate && { isApprovedDate: now }),
        };

      case FrickPaymentState.BOOKED:
        return {
          frickOrderStatus: order.state,
          frickError: null,
          ...(!entity.isApprovedDate && { isApprovedDate: now }),
          ...(!entity.isConfirmedDate && { isConfirmedDate: now }),
        };

      case FrickPaymentState.PREPARED:
      case FrickPaymentState.DELETION_REQUESTED:
        // Non-terminal: persist the status change only, no liquidity release, no isComplete.
        return { frickOrderStatus: order.state, frickError: null };

      case FrickPaymentState.REJECTED:
      case FrickPaymentState.EXPIRED:
      case FrickPaymentState.DELETED:
      case FrickPaymentState.ERROR:
        // Terminal and unpaid: persist the failure reason instead of erasing it - an operator (or the
        // stuckFiatOutputs monitor) must be able to see why this payout never completed.
        return {
          frickOrderStatus: order.state,
          frickError: entity.frickError ?? `Bank Frick order terminated: ${order.state}`,
        };

      default:
        throw new Error('Unsupported Bank Frick payment state');
    }
  }

  private isFrickAutomaticApprovalEnabled(): boolean {
    // Process gating is the caller's responsibility: checkFrickOrderStatus runs under
    // FIAT_OUTPUT_FRICK_STATUS_CHECK, transmitPayments under FIAT_OUTPUT_FRICK_TRANSMISSION.
    // Disabling the transmission switch must not also stop approval of already-created PREPARED
    // orders in the status job, or their liquidity stays stranded.
    return Config.bank.frick.payoutEnabled && Config.bank.frick.approveWithoutTan;
  }
}
