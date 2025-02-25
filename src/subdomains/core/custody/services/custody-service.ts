import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
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
    private readonly userDataService: UserDataService,
    private readonly walletService: WalletService,
    private readonly refService: RefService,
    private readonly authService: AuthService,
  ) {}
  //*** PUBLIC API ***//

  async createCustodyAccount(
    accountId: number,
    dto: CreateCustodyAccountDto,
    userIp: string,
  ): Promise<CustodyAuthResponseDto> {
    const ref = await this.refService.get(userIp);
    if (ref) dto.usedRef ??= ref.ref;

    const wallet = await this.walletService.getByIdOrName(undefined, 'DFX Custody');
    const addressIndex = await this.userService.getNexCustodyIndex();
    const custodyWallet = EvmUtil.createWallet(Config.blockchain.evm.custodyAccount(addressIndex));
    const signature = await custodyWallet.signMessage(Config.auth.signMessageGeneral + custodyWallet.address);

    const account = await this.userDataService.getUserData(accountId);
    if (!account) throw new NotFoundException('Account not exist');

    const custodyUser = await this.userService.createUser(
      {
        address: custodyWallet.address,
        signature,
        usedRef: dto.usedRef,
        ip: userIp,
        origin: ref?.origin,
        wallet,
        userData: account,
        custodyAddressType: dto.addressType,
        custodyAddressIndex: addressIndex,
        role: UserRole.CUSTODY,
      },
      dto.specialCode,
    );

    return { accessToken: this.authService.generateUserToken(custodyUser, userIp) };
  }
}
