import { BankData } from '../../user/models/bank-data/bank-data.entity';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { RiskStatus } from '../entities/name-check-log.entity';

export class CreateNameCheckLogDto {
  eventType: string;
  result: string;
  riskRate: RiskStatus;
  userData: UserData;
  bankData: BankData;
}
