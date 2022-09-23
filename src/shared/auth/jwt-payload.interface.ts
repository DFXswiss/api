import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { UserRole } from './user-role.enum';

export interface JwtBasicPayload {
  id: number;
  address: string;
  role: UserRole;
}

export interface JwtPayload extends JwtBasicPayload {
  blockchains: Blockchain[];
}

export interface JwtCompanyPayload extends JwtBasicPayload {}
