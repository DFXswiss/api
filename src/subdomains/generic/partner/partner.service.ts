import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { FeeService } from '../../supporting/payment/services/fee.service';
import { UserData } from '../user/models/user-data/user-data.entity';
import { UserDataStatus } from '../user/models/user-data/user-data.enum';
import { UserDataService } from '../user/models/user-data/user-data.service';
import { User } from '../user/models/user/user.entity';
import { UserService } from '../user/models/user/user.service';
import { PartnerFeeDto } from './dto/partner-fee.dto';
import { PartnerUserInfoDto } from './dto/partner-user-info.dto';

@Injectable()
export class PartnerService {
  constructor(
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly feeService: FeeService,
  ) {}

  // --- QUERIES --- //

  async findUserByAddress(address: string, callerUserId: number): Promise<PartnerUserInfoDto> {
    const callerRef = await this.getCallerRef(callerUserId);

    const user = await this.userService.getUserByAddress(address, { userData: true });
    if (!user) throw new NotFoundException('User not found');

    this.verifyUserInScope(user, callerRef);

    return this.toDto(user, callerRef);
  }

  async getMyReferees(callerUserId: number): Promise<PartnerUserInfoDto[]> {
    const callerRef = await this.getCallerRef(callerUserId);

    const users = await this.userService.getUsersByUsedRef(callerRef);

    return users.map((u) => this.toDto(u, callerRef));
  }

  async getAvailableFees(callerUserId: number): Promise<PartnerFeeDto[]> {
    const caller = await this.userService.getUser(callerUserId, { wallet: true });
    if (!caller?.ref) throw new ForbiddenException('Partner has no ref code assigned');

    const fees = await this.feeService.getCustomFeesForPartner(caller.ref, caller.wallet?.id);

    return fees.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      rate: f.rate,
      fixed: f.fixed,
    }));
  }

  // --- MUTATIONS --- //

  async setOnboarding(userDataId: number, feeId: number, callerUserId: number): Promise<void> {
    const callerRef = await this.getCallerRef(callerUserId);

    const userData = await this.userDataService.getUserData(userDataId, { users: true });
    if (!userData) throw new NotFoundException('UserData not found');

    this.verifyUserDataInScope(userData, callerRef);

    await this.feeService.addFeeInternal(userData, feeId);

    if (userData.status !== UserDataStatus.ACTIVE) {
      await this.userDataService.updateUserDataInternal(userData, { status: UserDataStatus.ACTIVE });
    }

    for (const u of userData.users) {
      if (u.usedRef === Config.defaultRef) {
        await this.userService.updateUserAdmin(u.id, { usedRef: callerRef });
      }
    }
  }

  async removeFee(userDataId: number, feeId: number, callerUserId: number): Promise<void> {
    const callerRef = await this.getCallerRef(callerUserId);

    const userData = await this.userDataService.getUserData(userDataId, { users: true });
    if (!userData) throw new NotFoundException('UserData not found');

    this.verifyUserDataInScope(userData, callerRef);

    await this.userDataService.removeFee(userData, feeId);
  }

  // --- HELPERS --- //

  private async getCallerRef(callerUserId: number): Promise<string> {
    const caller = await this.userService.getUser(callerUserId);
    if (!caller?.ref) throw new ForbiddenException('Partner has no ref code assigned');
    return caller.ref;
  }

  private verifyUserInScope(user: User, callerRef: string): void {
    if (user.usedRef !== Config.defaultRef && user.usedRef !== callerRef)
      throw new ForbiddenException('User is not in your referral scope');
  }

  private verifyUserDataInScope(userData: UserData, callerRef: string): void {
    const hasOutOfScopeUser = userData.users.some((u) => u.usedRef !== Config.defaultRef && u.usedRef !== callerRef);
    if (hasOutOfScopeUser) throw new ForbiddenException('UserData is not in your referral scope');
  }

  private toDto(user: User, callerRef: string): PartnerUserInfoDto {
    const ud = user.userData;
    return {
      id: ud.id,
      status: ud.status,
      mail: ud.mail,
      firstname: ud.firstname,
      surname: ud.surname,
      usedRef: user.usedRef,
      feeIds: ud.individualFeeList ?? [],
      canModify: user.usedRef === Config.defaultRef || user.usedRef === callerRef,
    };
  }
}
