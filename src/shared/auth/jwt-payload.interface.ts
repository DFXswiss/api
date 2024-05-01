import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { UserRole } from './user-role.enum';

export interface JwtPayload {
  id?: number;
  address?: string;
  role: UserRole;
  account?: number;
  blockchains?: Blockchain[];
  ip: string;
}
