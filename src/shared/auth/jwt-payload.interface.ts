import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { UserRole } from './user-role.enum';

export interface JwtPayloadBase {
  id: number;
  address: string;
  role: UserRole;
  ip: string;
}

export interface JwtPayload extends JwtPayloadBase {
  blockchains: Blockchain[];
}
