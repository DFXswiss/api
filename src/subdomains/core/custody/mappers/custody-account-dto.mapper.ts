import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CustodyAccountAccessDto, CustodyAccountDto } from '../dto/output/custody-account.dto';
import { CustodyAccountAccess } from '../entities/custody-account-access.entity';
import { CustodyAccount } from '../entities/custody-account.entity';
import { CustodyAccessLevel } from '../enums/custody';

export class CustodyAccountDtoMapper {
  static toDto(custodyAccount: CustodyAccount, accessLevel: CustodyAccessLevel): CustodyAccountDto {
    return {
      id: custodyAccount.id,
      title: custodyAccount.title,
      description: custodyAccount.description,
      isLegacy: false,
      accessLevel,
      owner: custodyAccount.owner ? { id: custodyAccount.owner.id } : undefined,
    };
  }

  static toLegacyDto(userData: UserData): CustodyAccountDto {
    return {
      id: null,
      title: 'Custody',
      description: undefined,
      isLegacy: true,
      accessLevel: CustodyAccessLevel.WRITE,
      owner: { id: userData.id },
    };
  }

  static toAccessDto(access: CustodyAccountAccess): CustodyAccountAccessDto {
    return {
      id: access.id,
      user: { id: access.userData.id },
      accessLevel: access.accessLevel,
    };
  }
}
