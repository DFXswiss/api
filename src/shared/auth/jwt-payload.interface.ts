import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { UserRole } from './user-role.enum';

export interface JwtChallengePayload {
  id: number;
  time: Date;
}

export interface JwtPayloadBase {
  id: number;
  address: string;
  role: UserRole;
}

export interface JwtPayload extends JwtPayloadBase {
  blockchains: Blockchain[];
}
