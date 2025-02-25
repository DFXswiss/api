import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { RefService } from '../../referral/process/ref.service';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CustodyAuthResponseDto } from '../dto/output/create-custody-account-output.dto';

@Injectable()
export class CustodyService {
  private readonly logger = new DfxLogger(CustodyService);

  constructor(
    private readonly userService: UserService,
    private readonly walletService: WalletService,
    private readonly refService: RefService,
    private readonly siftService: SiftService,
    private readonly authService: AuthService,
  ) {}
  //*** PUBLIC API ***//

  async createCustodyAccount(
    userId: number,
    dto: CreateCustodyAccountDto,
    userIp: string,
  ): Promise<CustodyAuthResponseDto> {
    const ref = await this.refService.get(userIp);
    if (ref) dto.usedRef ??= ref.ref;

    const wallet = await this.walletService.getByIdOrName(undefined, 'CustodyDFX');
    const addressIndex = await this.userService.getNexCustodyIndex();
    const custodyWallet = EvmUtil.createWallet(Config.blockchain.evm.custodyAccount(addressIndex));
    const signature = await custodyWallet.signMessage(Config.auth.signMessageGeneral + custodyWallet.address);

    const user = await this.userService.getUser(userId, { userData: true });
    if (!user) throw new NotFoundException('User not exist');

    const custodyUser = await this.userService.createUser(
      {
        address: custodyWallet.address,
        signature,
        usedRef: dto.usedRef,
        ip: userIp,
        origin: ref?.origin,
        wallet,
        userData: user.userData,
        custodyAddressType: dto.addressType,
        custodyAddressIndex: addressIndex,
        role: UserRole.CUSTODY,
      },
      dto.specialCode,
    );

    await this.siftService.createAccount(custodyUser);
    return { accessToken: this.authService.generateUserToken(custodyUser, userIp) };
  }
}
