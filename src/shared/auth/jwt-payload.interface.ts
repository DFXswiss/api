import { Blockchain } from 'src/ain/node/node.service';
import { UserRole } from './user-role.enum';

export interface JwtPayload {
  id: number;
  address: string;
  role: UserRole;
  blockchain: Blockchain;
}
