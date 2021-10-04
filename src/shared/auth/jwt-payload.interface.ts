import { UserRole } from "src/user/user.entity";

export interface JwtPayload {
  address: string;
  role: UserRole;
}
