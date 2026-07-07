import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { AmlSourceType } from '../entities/transaction-aml-check.entity';
import { AmlReason } from '../enums/aml-reason.enum';
import { CheckStatus } from '../enums/check-status.enum';

// Internal DTO — constructed by the buy-crypto / buy-fiat / transaction services at each amlCheck
// write site. Not exposed over HTTP, so no class-validator decorators.
export class CreateTransactionAmlCheckDto {
  entityType: string;
  entityId: number;
  source: AmlSourceType;
  previousAmlCheck?: CheckStatus;
  amlCheck?: CheckStatus;
  previousAmlReason?: AmlReason;
  amlReason?: AmlReason;
  amlResponsible?: string;
  comment?: string;
  priceDefinitionAllowedDate?: Date;
  highRisk?: boolean;
  transaction: Transaction;
}
