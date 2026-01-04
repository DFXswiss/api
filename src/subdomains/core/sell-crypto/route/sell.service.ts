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
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
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
    private readonly eip7702DelegationService: Eip7702DelegationService,
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

  async updateVolume(sellId: number, volume: number, annualVolume: number): Promise<void> {
    await this.sellRepo.update(sellId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.sellRepo.findOne({
      where: { id: sellId },
      relations: { user: true },
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateSellVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
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
      if (dto.permit) {
        type = 'permit';
        payIn = await this.transactionUtilService.handlePermitInput(route, request, dto.permit);
      } else if (dto.signedTxHex) {
        type = 'signed transaction';
        payIn = await this.transactionUtilService.handleSignedTxInput(route, request, dto.signedTxHex);
      } else if (dto.eip7702) {
        type = 'EIP-7702 delegation';
        payIn = await this.transactionUtilService.handleEip7702Input(route, request, dto.eip7702);
      } else {
        throw new BadRequestException('Either permit, signedTxHex, or eip7702 must be provided');
      }

      const buyFiat = await this.buyFiatService.createFromCryptoInput(payIn, route, request);
      await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_FIAT, route);
      return await this.buyFiatService.extendBuyFiat(buyFiat);
    } catch (e) {
      this.logger.warn(`Failed to execute ${type} transfer for sell request ${request.id}:`, e);
      throw new BadRequestException(`Failed to confirm request: ${e.message}`);
    }
  }

  async createDepositTx(request: TransactionRequest, route: Sell, userAddress?: string): Promise<UnsignedTxDto> {
    const asset = await this.assetService.getAssetById(request.sourceId);
    if (!asset) throw new BadRequestException('Asset not found');

    const client = this.blockchainRegistryService.getEvmClient(asset.blockchain);
    if (!client) throw new BadRequestException(`Unsupported blockchain`);

    const fromAddress = userAddress ?? request.user?.address;
    if (!fromAddress) throw new BadRequestException('User address not found');

    if (!route.deposit?.address) throw new BadRequestException('Deposit address not found');
    const depositAddress = route.deposit.address;

    // For sell flow: Check if EIP-7702 delegation is supported and user has zero native balance
    // The sell flow uses frontend-controlled delegation, not backend-controlled delegation
    const supportsEip7702 = this.eip7702DelegationService.isDelegationSupported(asset.blockchain);
    let hasZeroGas = false;

    if (supportsEip7702) {
      try {
        hasZeroGas = await this.eip7702DelegationService.hasZeroNativeBalance(fromAddress, asset.blockchain);
      } catch (_) {
        // If balance check fails (RPC error, network issue, etc.), assume user has gas
        this.logger.verbose(`Balance check failed for ${fromAddress} on ${asset.blockchain}, assuming user has gas`);
        hasZeroGas = false;
      }
    }

    try {
      const unsignedTx = await client.prepareTransaction(asset, fromAddress, depositAddress, request.amount);

      // Add EIP-7702 delegation data if user has 0 gas
      if (hasZeroGas) {
        this.logger.info(`User ${fromAddress} has 0 gas on ${asset.blockchain}, providing EIP-7702 delegation data`);
        const delegationData = await this.eip7702DelegationService.prepareDelegationData(fromAddress, asset.blockchain);

        unsignedTx.eip7702 = {
          relayerAddress: delegationData.relayerAddress,
          delegationManagerAddress: delegationData.delegationManagerAddress,
          delegatorAddress: delegationData.delegatorAddress,
          userNonce: delegationData.userNonce,
          domain: delegationData.domain,
          types: delegationData.types,
          message: delegationData.message,
        };
      }

      return unsignedTx;
    } catch (e) {
      // Special handling for INSUFFICIENT_FUNDS error when EIP-7702 is available
      const isInsufficientFunds = e.code === 'INSUFFICIENT_FUNDS' || e.message?.includes('insufficient funds');

      if (isInsufficientFunds && supportsEip7702) {
        this.logger.info(
          `Gas estimation failed due to insufficient funds for user ${fromAddress}, creating transaction with EIP-7702 delegation`,
        );

        // Create a basic unsigned transaction without gas estimation
        // The actual gas will be paid by the relayer through EIP-7702 delegation
        const delegationData = await this.eip7702DelegationService.prepareDelegationData(fromAddress, asset.blockchain);

        const unsignedTx: UnsignedTxDto = {
          chainId: client.chainId,
          from: fromAddress,
          to: depositAddress,
          value: '0', // Will be set based on asset type
          data: '0x',
          nonce: 0, // Will be set by frontend/relayer
          gasPrice: '0', // Will be set by relayer
          gasLimit: '0', // Will be set by relayer
          eip7702: {
            relayerAddress: delegationData.relayerAddress,
            delegationManagerAddress: delegationData.delegationManagerAddress,
            delegatorAddress: delegationData.delegatorAddress,
            userNonce: delegationData.userNonce,
            domain: delegationData.domain,
            types: delegationData.types,
            message: delegationData.message,
          },
        };

        return unsignedTx;
      }

      // For other errors, log and throw
      this.logger.warn(`Failed to create deposit TX for sell request ${request.id}:`, e);
      throw new BadRequestException(`Failed to create deposit transaction: ${e.reason ?? e.message}`);
    }
  }

  private async toPaymentInfoDto(
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

    if (includeTx && isValid) {
      try {
        sellDto.depositTx = await this.createDepositTx(transactionRequest, sell, user.address);
      } catch (e) {
        this.logger.warn(`Could not create deposit transaction for sell request ${sell.id}, continuing without it:`, e);
        sellDto.depositTx = undefined;
      }
    }

    return sellDto;
  }
}
