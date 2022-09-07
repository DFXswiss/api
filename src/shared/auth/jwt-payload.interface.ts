import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { UserRole } from './user-role.enum';

export interface JwtPayload {
  id: number;
  address: string;
  role: UserRole;
  blockchains: Blockchain[];
}
