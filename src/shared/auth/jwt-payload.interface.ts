import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { UserRole } from './user-role.enum';

export interface JwtBasicPayload {
  id: number;
  address: string;
}

export interface JwtPayload extends JwtBasicPayload {
  role: UserRole;
  blockchains: Blockchain[];
}

export interface JwtCompanyPayload extends JwtBasicPayload {
  isKycClient: boolean;
}
