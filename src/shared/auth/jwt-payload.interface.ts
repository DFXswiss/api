import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { UserRole } from './user-role.enum';

export interface JwtPayload {
  account?: number; // user data ID
  user?: number; // user/wallet ID
  id?: number; // TODO: remove temporary code
  address?: string; // user/wallet address
  role: UserRole;
  blockchains?: Blockchain[];
  ip: string;
}
