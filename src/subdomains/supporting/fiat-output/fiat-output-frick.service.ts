import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { FrickPaymentCharge, FrickPaymentOrder, FrickPaymentState } from 'src/integration/bank/dto/frick.dto';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { IbanService } from 'src/integration/bank/services/iban.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { IbanBankName } from '../bank/bank/dto/bank.dto';
import { FiatOutput, TransactionCharge } from './fiat-output.entity';
import { FiatOutputRepository } from './fiat-output.repository';

@Injectable()
export class FiatOutputFrickService {
  // DELETION_REQUESTED is intentionally NOT terminal: the bank order can still be executed or fail
  // later, so liquidity must stay reserved and the status must keep being polled until a real
  // terminal state (or a matching debit bankTx via the isComplete path) arrives.
  private static readonly FRICK_TERMINAL_STATES = [
    FrickPaymentState.REJECTED,
    FrickPaymentState.EXPIRED,
    FrickPaymentState.DELETED,
    FrickPaymentState.ERROR,
  ];

  private readonly logger = new DfxLogger(FiatOutputFrickService);

  constructor(
    private readonly fiatOutputRepo: FiatOutputRepository,
    private readonly frickService: BankFrickService,
    private readonly ibanService: IbanService,
  ) {}

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.FIAT_OUTPUT })
  async checkFrickOrderStatus(): Promise<void> {
    if (DisabledProcess(Process.FIAT_OUTPUT_FRICK_STATUS_CHECK)) return;
    if (!this.frickService.isAvailable()) return;

    const statusRequest: FindOptionsWhere<FiatOutput> = { frickTxId: Not(IsNull()), isComplete: false };
    const entities = await this.fiatOutputRepo.find({
      where: [
        { ...statusRequest, frickOrderStatus: IsNull() },
        { ...statusRequest, frickOrderStatus: Not(In(FiatOutputFrickService.FRICK_TERMINAL_STATES)) },
      ],
    });

    for (const entity of entities) {
      try {
        let order = await this.frickService.getPaymentOrder(entity.frickTxId);

        if (order.state === FrickPaymentState.PREPARED && this.isFrickAutomaticApprovalEnabled()) {
          order = await this.frickService.approvePaymentWithoutTan(order);
        }

        const updateData = this.getFrickStatusUpdate(order, entity);
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
        frickTxId: IsNull(),
        isComplete: false,
        bank: { name: IbanBankName.FRICK },
      },
    });

    for (const entity of entities) {
      try {
        const customId = `DFX-FO-${entity.id}`;
        const remittanceInfo = this.createUniqueReference(customId, entity.remittanceInfo);
        const address = entity.address ? [entity.address, entity.houseNumber].filter(Boolean).join(' ') : undefined;
        const creditorBic = await this.resolveCreditorBic(entity);
        const outputCharge = entity.currency === 'CHF' ? (entity.charge ?? TransactionCharge.SHA) : entity.charge;
        const charge = outputCharge
          ? {
              [TransactionCharge.BEN]: FrickPaymentCharge.BENEFICIARY,
              [TransactionCharge.OUR]: FrickPaymentCharge.OUR,
              [TransactionCharge.SHA]: FrickPaymentCharge.SHARED,
            }[outputCharge]
          : undefined;

        const order = await this.frickService.createPaymentOrder({
          customId,
          amount: entity.amount,
          currency: entity.currency as 'CHF' | 'EUR',
          instant: entity.isInstant,
          reference: remittanceInfo,
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

        // Persist the bank-side identity before any optional approval call. If approval fails, the
        // status job continues with the stable customId and never creates another payment order.
        await this.fiatOutputRepo.update(entity.id, {
          frickTxId: customId,
          ...(safeOrderId && { frickOrderId: safeOrderId }),
          remittanceInfo,
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
    return status !== undefined && FiatOutputFrickService.FRICK_TERMINAL_STATES.includes(status);
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
        return { frickOrderStatus: order.state, frickError: null };

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
