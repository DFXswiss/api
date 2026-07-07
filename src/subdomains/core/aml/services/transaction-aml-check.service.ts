import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { CreateTransactionAmlCheckDto } from '../dto/create-transaction-aml-check.dto';
import { AmlSourceType } from '../entities/transaction-aml-check.entity';
import { AmlReason } from '../enums/aml-reason.enum';
import { CheckStatus } from '../enums/check-status.enum';
import { TransactionAmlCheckRepository } from '../repositories/transaction-aml-check.repository';

// Structural shape shared by BuyCrypto and BuyFiat. Declared here (rather than importing the concrete
// process entities) so core/aml keeps no reverse dependency on the buy-crypto / sell-crypto subdomains;
// BuyCrypto and BuyFiat satisfy it structurally.
export interface AmlCheckHistorySource {
  id: number;
  transaction: Transaction;
  amlCheck?: CheckStatus;
  amlReason?: AmlReason;
  amlResponsible?: string;
  comment?: string;
  priceDefinitionAllowedDate?: Date;
  highRisk?: boolean;
}

// Append-only amlCheck audit trail. Immutable by construction: the service exposes only `create` (and
// the `createFromEntity` convenience that funnels into it), never update/save-existing or delete, so
// every persisted row is a permanent record of one amlCheck transition (`updated` always equals
// `created`).
//
// This is a STRICTLY SECONDARY compliance copy — the authoritative record is the amlCheck already
// persisted on the transaction. It rides on the critical path of many existing operations (AML cron,
// manual compliance actions, chargebacks, resets, admin edits) and always runs AFTER that state is
// committed, so it must never disrupt them: the write is FAIL-OPEN (a failure is swallowed + logged,
// never rethrown) and the whole feature sits behind a process kill-switch so ops can stop the writes
// within ~30s via the `disabledProcesses` setting, without a redeploy.
@Injectable()
export class TransactionAmlCheckService {
  private readonly logger = new DfxLogger(TransactionAmlCheckService);

  constructor(private readonly repo: TransactionAmlCheckRepository) {}

  async create(dto: CreateTransactionAmlCheckDto): Promise<void> {
    // Kill-switch: ops can disable the audit writes within ~30s via the `disabledProcesses` setting
    // (no redeploy) if they ever cause load/noise. Default: enabled.
    if (DisabledProcess(Process.TRANSACTION_AML_CHECK_LOG)) return;

    try {
      await this.repo.save(this.repo.create(dto));
    } catch (e) {
      // Fail-open: the transaction's amlCheck is already committed (the authoritative record); a failed
      // secondary audit copy must never break, 500 or roll back the operation it rides on. Log and move
      // on — the missing row is a known, monitorable gap, not an outage.
      this.logger.error(`Failed to write amlCheck audit row for ${dto.entityType} ${dto.entityId}:`, e);
    }
  }

  // Append one immutable amlCheck-history row for `entity`, but only when the persisted mutation
  // actually changed the amlCheck verdict or its reason (a genuine transition). `previousAmlCheck` /
  // `previousAmlReason` are the values read BEFORE the mutation; the new values are read from `entity`.
  async createFromEntity(
    entity: AmlCheckHistorySource,
    entityType: string,
    source: AmlSourceType,
    previousAmlCheck?: CheckStatus,
    previousAmlReason?: AmlReason,
  ): Promise<void> {
    if (previousAmlCheck === entity.amlCheck && previousAmlReason === entity.amlReason) return;

    await this.create({
      transaction: entity.transaction,
      entityType,
      entityId: entity.id,
      source,
      previousAmlCheck,
      amlCheck: entity.amlCheck,
      previousAmlReason,
      amlReason: entity.amlReason,
      amlResponsible: entity.amlResponsible,
      comment: entity.comment,
      priceDefinitionAllowedDate: entity.priceDefinitionAllowedDate,
      highRisk: entity.highRisk,
    });
  }
}
