import { Injectable } from '@nestjs/common';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { CreateTransactionAmlCheckDto } from '../dto/create-transaction-aml-check.dto';
import { AmlSourceType, TransactionAmlCheck } from '../entities/transaction-aml-check.entity';
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

// Append-only amlCheck audit trail. Immutable by construction: the service exposes only `create`
// (and the `createFromEntity` convenience that funnels into it), never update/save-existing or delete,
// so every persisted row is a permanent record of one amlCheck transition (`updated` always equals
// `created`).
@Injectable()
export class TransactionAmlCheckService {
  constructor(private readonly repo: TransactionAmlCheckRepository) {}

  async create(dto: CreateTransactionAmlCheckDto): Promise<TransactionAmlCheck> {
    return this.repo.save(this.repo.create(dto));
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
