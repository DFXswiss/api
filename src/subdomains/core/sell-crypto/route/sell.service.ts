import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { merge } from 'lodash';
import { Config } from 'src/config/config';
import { PimlicoBundlerService } from 'src/integration/blockchain/shared/evm/paymaster/pimlico-bundler.service';
import { PimlicoPaymasterService } from 'src/integration/blockchain/shared/evm/paymaster/pimlico-paymaster.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CreateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/create-sell.dto';
import { UpdateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/update-sell.dto';
import { SellRepository } from 'src/subdomains/core/sell-crypto/route/sell.repository';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  TransactionRequest,
  TransactionRequestType,
} from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { FindOneOptions, In, IsNull, Like, Not } from 'typeorm';
import { DepositService } from '../../../supporting/address-pool/deposit/deposit.service';
import { BuyFiatExtended } from '../../history/mappers/transaction-dto.mapper';
import { RouteService } from '../../route/route.service';
import { TransactionUtilService } from '../../transaction/transaction-util.service';
import { BuyFiatService } from '../process/services/buy-fiat.service';
import { ConfirmDto } from './dto/confirm.dto';
import { GetSellPaymentInfoDto } from './dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from './dto/sell-payment-info.dto';
import { UnsignedTxDto } from './dto/unsigned-tx.dto';
import { Sell } from './sell.entity';

@Injectable()
export class SellService {
  private readonly logger = new DfxLogger(SellService);

  constructor(
    private readonly sellRepo: SellRepository,
    private readonly depositService: DepositService,
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly assetService: AssetService,
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    @Inject(forwardRef(() => TransactionUtilService))
    private readonly transactionUtilService: TransactionUtilService,
    private readonly routeService: RouteService,
    private readonly bankDataService: BankDataService,
    @Inject(forwardRef(() => TransactionHelper))
    private readonly transactionHelper: TransactionHelper,
    private readonly cryptoService: CryptoService,
    @Inject(forwardRef(() => TransactionRequestService))
    private readonly transactionRequestService: TransactionRequestService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly pimlicoPaymasterService: PimlicoPaymasterService,
    private readonly pimlicoBundlerService: PimlicoBundlerService,
  ) {}

  // --- SELLS --- //
  async get(userId: number, id: number): Promise<Sell> {
    const sell = await this.sellRepo.findOne({
      where: { id, user: { id: userId } },
      relations: { user: { userData: { organization: true } } },
    });
    if (!sell) throw new NotFoundException('Sell not found');
    return sell;
  }

  async getById(id: number, options?: FindOneOptions<Sell>): Promise<Sell> {
    const defaultOptions = { where: { id }, relations: { user: { userData: { organization: true } } } };
    return this.sellRepo.findOne(merge(defaultOptions, options));
  }

  async getSellByKey(key: string, value: any, onlyDefaultRelation = false): Promise<Sell> {
    const query = this.sellRepo
      .createQueryBuilder('sell')
      .select('sell')
      .leftJoinAndSelect('sell.deposit', 'deposit')
      .leftJoinAndSelect('sell.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .where(`${key.includes('.') ? key : `sell.${key}`} = :param`, { param: value });

    if (!onlyDefaultRelation) {
      query.leftJoinAndSelect('userData.users', 'users');
      query.leftJoinAndSelect('userData.kycSteps', 'kycSteps');
      query.leftJoinAndSelect('userData.country', 'country');
      query.leftJoinAndSelect('userData.nationality', 'nationality');
      query.leftJoinAndSelect('userData.organizationCountry', 'organizationCountry');
      query.leftJoinAndSelect('userData.verifiedCountry', 'verifiedCountry');
      query.leftJoinAndSelect('userData.language', 'language');
      query.leftJoinAndSelect('users.wallet', 'wallet');
    }

    return query.getOne();
  }

  async getSellsByIban(iban: string): Promise<Sell[]> {
    return this.sellRepo.find({ where: { iban }, relations: { user: { userData: true } } });
  }

  async getUserSells(userId: number): Promise<Sell[]> {
    const sellableBlockchains = await this.assetService.getSellableBlockchains();

    const sells = await this.sellRepo.find({
      where: {
        user: { id: userId },
        fiat: { buyable: true },
        active: true,
      },
      relations: { deposit: true, user: true },
    });

    return sells.filter((s) => s.deposit.blockchainList.some((b) => sellableBlockchains.includes(b)));
  }

  async getSellsByUserDataId(userDataId: number): Promise<Sell[]> {
    return this.sellRepo.find({
      where: { user: { userData: { id: userDataId } } },
      relations: { fiat: true, user: true },
    });
  }

  async getSellWithoutRoute(): Promise<Sell[]> {
    return this.sellRepo.findBy({ route: { id: IsNull() } });
  }

  async createSellPaymentInfo(
    userId: number,
    dto: GetSellPaymentInfoDto,
    includeTx: boolean,
  ): Promise<SellPaymentInfoDto> {
    const sell = await Util.retry(
      () => this.createSell(userId, { ...dto, blockchain: dto.asset.blockchain }, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    );
    return this.toPaymentInfoDto(userId, sell, dto, includeTx);
  }

  async createSell(userId: number, dto: CreateSellDto, ignoreException = false): Promise<Sell> {
    // check user data
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (!userData.isDataComplete && !ignoreException) throw new BadRequestException('Ident data incomplete');

    // check if exists
    const existing = await this.sellRepo.findOne({
      where: {
        iban: dto.iban,
        fiat: { id: dto.currency.id },
        user: { id: userId },
        deposit: { blockchains: Like(`%${dto.blockchain}%`) },
      },
      relations: { deposit: true, user: true },
    });

    if (existing) {
      if (existing.active && !ignoreException) throw new ConflictException('Sell route already exists');

      if (!existing.active && userData.isDataComplete) {
        // reactivate deleted route
        existing.active = true;
        existing.bankData = await this.bankDataService.createIbanForUser(
          userData.id,
          { iban: dto.iban },
          true,
          BankDataType.USER,
        );
        await this.sellRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const sell = this.sellRepo.create(dto);
    sell.user = await this.userService.getUser(userId, { userData: true });
    sell.route = await this.routeService.createRoute({ sell });
    sell.fiat = dto.currency;
    sell.deposit = await this.depositService.getNextDeposit(dto.blockchain);
    sell.bankData = await this.bankDataService.createIbanForUser(
      userData.id,
      { iban: dto.iban },
      true,
      BankDataType.USER,
    );

    return this.sellRepo.save(sell);
  }

  async updateSell(userId: number, sellId: number, dto: UpdateSellDto): Promise<Sell> {
    const sell = await this.sellRepo.findOne({
      where: { id: sellId, user: { id: userId } },
      relations: { user: true },
    });
    if (!sell) throw new NotFoundException('Sell route not found');

    return this.sellRepo.save({ ...sell, ...dto });
  }

  // --- VOLUMES --- //
  @DfxCron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.sellRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  @DfxCron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async resetMonthlyVolumes(): Promise<void> {
    await this.sellRepo.update({ monthlyVolume: Not(0) }, { monthlyVolume: 0 });
  }

  async updateVolume(sellId: number, volume: number, annualVolume: number, monthlyVolume: number): Promise<void> {
    await this.sellRepo.update(sellId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
      monthlyVolume: Util.round(monthlyVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.sellRepo.findOne({
      where: { id: sellId },
      relations: { user: true },
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);

    await this.userService.updateSellVolume(
      user.id,
      userVolume.volume,
      userVolume.annualVolume,
      userVolume.monthlyVolume,
    );
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number; monthlyVolume: number }> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .addSelect('SUM(monthlyVolume)', 'monthlyVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number; monthlyVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  async getAllUserSells(userIds: number[]): Promise<Sell[]> {
    return this.sellRepo.find({
      where: { user: { id: In(userIds) } },
      relations: { user: true },
      order: { id: 'DESC' },
    });
  }

  // --- CONFIRMATION --- //
  async confirmSell(request: TransactionRequest, dto: ConfirmDto): Promise<BuyFiatExtended> {
    const route = await this.sellRepo.findOne({
      where: { id: request.routeId },
      relations: { deposit: true, user: { wallet: true, userData: true } },
    });
    if (!route) throw new NotFoundException('Sell route not found');

    let type: string;
    let payIn: CryptoInput;

    try {
      if (dto.authorization) {
        type = 'gasless transfer';
        const asset = await this.assetService.getAssetById(request.sourceId);
        if (!asset) throw new BadRequestException('Asset not found');

        if (!this.pimlicoBundlerService.isGaslessSupported(asset.blockchain)) {
          throw new BadRequestException(`Gasless transactions not supported for ${asset.blockchain}`);
        }

        const result = await this.pimlicoBundlerService.executeGaslessTransfer(
          request.user.address,
          asset,
          route.deposit.address,
          request.amount,
          dto.authorization,
        );

        payIn = await this.transactionUtilService.handleTxHashInput(route, request, result.txHash);
      } else if (dto.permit) {
        type = 'permit';
        payIn = await this.transactionUtilService.handlePermitInput(route, request, dto.permit);
      } else if (dto.signedTxHex) {
        type = 'signed transaction';
        payIn = await this.transactionUtilService.handleSignedTxInput(route, request, dto.signedTxHex);
      } else if (dto.txHash) {
        type = 'EIP-5792 sponsored transfer';
        payIn = await this.transactionUtilService.handleTxHashInput(route, request, dto.txHash);
      } else {
        throw new BadRequestException('Either permit, signedTxHex, txHash, or authorization must be provided');
      }

      const buyFiat = await this.buyFiatService.createFromCryptoInput(payIn, route, request);
      await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_FIAT, route);
      return await this.buyFiatService.extendBuyFiat(buyFiat);
    } catch (e) {
      this.logger.warn(`Failed to execute ${type} transfer for sell request ${request.id}:`, e);
      throw new BadRequestException(`Failed to confirm request: ${e.message}`);
    }
  }

  async createDepositTx(
    request: TransactionRequest,
    route: Sell,
    userAddress?: string,
    includeEip5792 = false,
  ): Promise<UnsignedTxDto> {
    const asset = await this.assetService.getAssetById(request.sourceId);
    if (!asset) throw new BadRequestException('Asset not found');

    const client = this.blockchainRegistryService.getEvmClient(asset.blockchain);
    if (!client) throw new BadRequestException(`Unsupported blockchain`);

    const fromAddress = userAddress ?? request.user?.address;
    if (!fromAddress) throw new BadRequestException('User address not found');

    if (!route.deposit?.address) throw new BadRequestException('Deposit address not found');
    const depositAddress = route.deposit.address;

    // Check if Pimlico paymaster is available for this blockchain
    const paymasterAvailable = this.pimlicoPaymasterService.isPaymasterAvailable(asset.blockchain);
    const paymasterUrl = paymasterAvailable ? this.pimlicoPaymasterService.getBundlerUrl(asset.blockchain) : undefined;

    try {
      const unsignedTx = await client.prepareTransaction(asset, fromAddress, depositAddress, request.amount);

      // Add EIP-5792 paymaster data only if user has 0 native balance (needs gasless)
      if (includeEip5792 && paymasterUrl) {
        unsignedTx.eip5792 = {
          paymasterUrl,
          chainId: client.chainId,
          calls: [{ to: unsignedTx.to, data: unsignedTx.data, value: unsignedTx.value }],
        };
      }

      return unsignedTx;
    } catch (e) {
      this.logger.warn(`Failed to create deposit TX for sell request ${request.id}:`, e);
      throw new BadRequestException(`Failed to create deposit transaction: ${e.reason ?? e.message}`);
    }
  }

  async toPaymentInfoDto(
    userId: number,
    sell: Sell,
    dto: GetSellPaymentInfoDto,
    includeTx: boolean,
  ): Promise<SellPaymentInfoDto> {
    const user = await this.userService.getUser(userId, { userData: { users: true }, wallet: true });

    const {
      timestamp,
      minVolume,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      exchangeRate,
      rate,
      estimatedAmount,
      sourceAmount: amount,
      isValid,
      error,
      exactPrice,
      feeSource,
      feeTarget,
      priceSteps,
    } = await this.transactionHelper.getTxDetails(
      dto.amount,
      dto.targetAmount,
      dto.asset,
      dto.currency,
      CryptoPaymentMethod.CRYPTO,
      FiatPaymentMethod.BANK,
      dto.exactPrice,
      user,
      undefined,
      undefined,
      sell.iban.substring(0, 2),
    );

    const sellDto: SellPaymentInfoDto = {
      id: 0, // set during request creation
      timestamp,
      routeId: sell.id,
      fee: Util.round(feeSource.rate * 100, Config.defaultPercentageDecimal),
      depositAddress: sell.active ? sell.deposit.address : undefined,
      blockchain: dto.asset.blockchain,
      minDeposit: { amount: minVolume, asset: dto.asset.dexName },
      minVolume,
      minFee: feeSource.min,
      minVolumeTarget,
      minFeeTarget: feeTarget.min,
      fees: feeSource,
      exchangeRate,
      rate,
      exactPrice,
      priceSteps,
      estimatedAmount,
      amount,
      currency: FiatDtoMapper.toDto(dto.currency),
      beneficiary: { name: user.userData.verifiedName, iban: sell.iban },
      asset: AssetDtoMapper.toDto(dto.asset),
      maxVolume,
      maxVolumeTarget,
      feesTarget: feeTarget,
      paymentRequest: sell.active
        ? await this.cryptoService.getPaymentRequest(isValid, dto.asset, sell.deposit.address, amount)
        : undefined,
      isValid,
      error,
    };

    const transactionRequest = await this.transactionRequestService.create(
      TransactionRequestType.SELL,
      dto,
      sellDto,
      user.id,
    );

    // Assign complete user object to ensure user.address is available for createDepositTx
    transactionRequest.user = user;

    // Check if user needs gasless transaction (0 native balance) - must be done BEFORE createDepositTx
    let hasZeroBalance = false;
    if (isValid && this.pimlicoBundlerService.isGaslessSupported(dto.asset.blockchain)) {
      try {
        hasZeroBalance = await this.pimlicoBundlerService.hasZeroNativeBalance(user.address, dto.asset.blockchain);
        sellDto.gaslessAvailable = hasZeroBalance;

        if (hasZeroBalance) {
          sellDto.eip7702Authorization = await this.pimlicoBundlerService.prepareAuthorizationData(
            user.address,
            dto.asset.blockchain,
          );
        }
      } catch (e) {
        this.logger.warn(`Could not prepare gasless data for sell request ${sell.id}:`, e);
        sellDto.gaslessAvailable = false;
      }
    }

    // Create deposit transaction - only include EIP-5792 data if user has 0 native balance
    if (includeTx && isValid) {
      try {
        sellDto.depositTx = await this.createDepositTx(transactionRequest, sell, user.address, hasZeroBalance);
      } catch (e) {
        this.logger.warn(`Could not create deposit transaction for sell request ${sell.id}, continuing without it:`, e);
        sellDto.depositTx = undefined;
      }
    }

    return sellDto;
  }
}
