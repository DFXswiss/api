import { Blockchain } from 'src/ain/services/crypto.service';
import { UserRole } from './user-role.enum';

export interface JwtPayload {
  id: number;
  address: string;
  role: UserRole;
  blockchains: Blockchain[];
}
