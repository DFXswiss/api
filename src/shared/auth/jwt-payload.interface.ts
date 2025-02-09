import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserRole } from './user-role.enum';

export interface JwtPayload {
  account?: number; // user data ID
  user?: number; // user/wallet ID
  address?: string; // user/wallet address
  role: UserRole;
  blockchains?: Blockchain[];
  ip: string;
  userStatus?: UserStatus;
  userDataStatus?: UserDataStatus;
}
