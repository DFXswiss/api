import { Body, Controller, Get, Put, UseGuards, Post, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/util';
import { UserService } from 'src/user/models/user/user.service';
import { In } from 'typeorm';
import { BuyCryptoHistoryDto } from '../buy-crypto/dto/buy-crypto-history.dto';
import { BuyCryptoService } from '../buy-crypto/services/buy-crypto.service';
import { Deposit } from '../deposit/deposit.entity';
import { StakingDto } from '../staking/dto/staking.dto';
import { Staking } from '../staking/staking.entity';
import { StakingRepository } from '../staking/staking.repository';
import { StakingService } from '../staking/staking.service';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { BuyType } from './dto/buy-type.enum';
import { BuyDto } from './dto/buy.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { BankInfoDto, BuyPaymentInfoDto } from './dto/buy-payment-info.dto';
import { GetBuyPaymentInfoDto } from './dto/get-buy-payment-info.dto';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { BankAccountService } from '../bank-account/bank-account.service';

@ApiTags('buy')
@Controller('buy')
export class BuyController {
  constructor(
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly stakingRepo: StakingRepository,
    private readonly stakingService: StakingService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly fiatService: FiatService,
    private readonly countryService: CountryService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuy(@GetJwt() jwt: JwtPayload): Promise<BuyDto[]> {
    return this.buyService.getUserBuys(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createBuy(@GetJwt() jwt: JwtPayload, @Body() dto: CreateBuyDto): Promise<BuyDto> {
    return this.buyService.createBuy(jwt.id, jwt.address, dto).then((b) => this.toDto(jwt.id, b));
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiResponse({ status: 200, type: BuyPaymentInfoDto })
  async createBuyWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetBuyPaymentInfoDto,
  ): Promise<BuyPaymentInfoDto> {
    return this.buyService
      .createBuy(jwt.id, jwt.address, { ...dto, type: BuyType.WALLET }, true)
      .then((buy) => this.toPaymentInfoDto(jwt.id, buy, dto));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateBuyRoute(@GetJwt() jwt: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBuyDto): Promise<BuyDto> {
    return this.buyService.updateBuy(jwt.id, +id, dto).then((b) => this.toDto(jwt.id, b));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getBuyRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyCryptoHistoryDto[]> {
    return this.buyCryptoService.getHistory(jwt.id, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, buys: Buy[]): Promise<BuyDto[]> {
    const fees = await this.getFees(userId);

    const stakingRoutes = await this.stakingRepo.find({ deposit: { id: In(buys.map((b) => b.deposit?.id)) } });
    return Promise.all(buys.map((b) => this.toDto(userId, b, fees, stakingRoutes)));
  }

  private async toDto(
    userId: number,
    buy: Buy,
    fees?: { fee: number; refBonus: number },
    stakingRoutes?: Staking[],
  ): Promise<BuyDto> {
    fees ??= await this.getFees(userId);
    return {
      type: buy.deposit != null ? BuyType.STAKING : BuyType.WALLET,
      ...buy,
      staking: await this.getStaking(userId, buy.deposit, stakingRoutes),
      ...fees,
      minDeposits: Util.transformToMinDeposit(Config.blockchain.default.minDeposit.Fiat),
    };
  }

  private async toPaymentInfoDto(userId: number, buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BuyPaymentInfoDto> {
    return {
      ...(await this.getBankInfo(buy, dto)),
      remittanceInfo: buy.bankUsage,
      ...(await this.getFees(userId)),
      minDeposits: Util.transformToMinDeposit(Config.blockchain.default.minDeposit.Fiat),
    };
  }

  // --- HELPER-METHODS --- //
  private async getStaking(
    userId: number,
    deposit?: Deposit,
    stakingRoutes?: Staking[],
  ): Promise<StakingDto | undefined> {
    if (deposit == null) return undefined;

    return this.stakingService.toDto(
      userId,
      stakingRoutes
        ? stakingRoutes.find((s) => s.deposit.id === deposit.id)
        : await this.stakingRepo.findOne({ where: { deposit: deposit.id } }),
    );
  }

  async getFees(userId: number): Promise<{ fee: number; refBonus: number }> {
    const { annualVolume } = await this.buyService.getUserVolume(userId);
    return this.userService.getUserBuyFee(userId, annualVolume);
  }

  private async getBankInfo(buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BankInfoDto> {
    let account: { currency: string; iban: string; bic: string };

    const frickAmountLimit = 9000;
    const fallBackCurrency = 'EUR';

    dto.currency = await this.fiatService.getFiat(dto.currency.id);
    const ibanCodeCountry = await this.countryService.getCountryWithSymbol(buy.bankAccount.iban.substring(0, 2));

    // select the matching bank account
    if (dto.amount > frickAmountLimit || dto.currency.name === 'USD') {
      // amount > 9k => Frick || USD => Frick
      account = this.getMatchingAccount(Config.bank.frick.accounts, dto.currency.name, fallBackCurrency);
    } else if (dto.currency.name === 'EUR' && buy.bankAccount.sctInst) {
      // instant => Olkypay / EUR
      account = Config.bank.olkypay.account;
    } else if (ibanCodeCountry.maerkiBaumannEnable && buy.user.userData.country.maerkiBaumannEnable) {
      // Valid Maerki Baumann country => MB CHF/USD/EUR
      account = this.getMatchingAccount(Config.bank.maerkiBaumann.accounts, dto.currency.name, fallBackCurrency);
    } else {
      // Default => Frick
      account = this.getMatchingAccount(Config.bank.frick.accounts, dto.currency.name, fallBackCurrency);
    }

    return { ...Config.bank.dfxBankInfo, iban: account.iban, bic: account.bic };
  }

  private getMatchingAccount(
    bankAccounts: { currency: string; iban: string; bic: string }[],
    currencyName: string,
    fallBackCurrencyName: string,
  ): { currency: string; iban: string; bic: string } {
    return (
      bankAccounts.find((b) => b.currency === currencyName) ??
      bankAccounts.find((b) => b.currency === fallBackCurrencyName)
    );
  }
}
