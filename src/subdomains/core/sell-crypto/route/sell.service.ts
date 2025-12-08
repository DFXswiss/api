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
import { BigNumber } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
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
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInPurpose, PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
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
import { PaymentLink } from '../../payment-link/entities/payment-link.entity';
import { RouteService } from '../../route/route.service';
import { TransactionUtilService } from '../../transaction/transaction-util.service';
import { BuyFiatService } from '../process/services/buy-fiat.service';
import { BroadcastSellDto } from './dto/broadcast-sell.dto';
import { PreparedTxDto } from './dto/prepared-tx.dto';
import { ConfirmDto } from './dto/confirm.dto';
import { GetSellPaymentInfoDto } from './dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from './dto/sell-payment-info.dto';
import { SellPaymentInfoWithTxDto } from './dto/sell-payment-info-with-tx.dto';
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
    private readonly txValidationService: TxValidationService,
  ) {}

  // --- SELLS --- //
  async get(userId: number, id: number): Promise<Sell> {
    const sell = await this.sellRepo.findOne({
      where: { id, user: { id: userId } },
      relations: { user: { userData: true } },
    });
    if (!sell) throw new NotFoundException('Sell not found');
    return sell;
  }

  async getById(id: number, options?: FindOneOptions<Sell>): Promise<Sell> {
    const defaultOptions = { where: { id }, relations: { user: { userData: true } } };
    return this.sellRepo.findOne(merge(defaultOptions, options));
  }

  async getLatest(userId: number): Promise<Sell | null> {
    return this.sellRepo.findOne({
      where: { user: { id: userId } },
      relations: { user: { userData: true } },
      order: { created: 'DESC' },
    });
  }

  async getByLabel(userId: number, label: string, options?: FindOneOptions<Sell>): Promise<Sell> {
    const defaultOptions = {
      where: { route: { label }, user: { id: userId } },
      relations: { user: { userData: true } },
    };
    return this.sellRepo.findOne(merge(defaultOptions, options));
  }

  validateLightningRoute(route: Sell): void {
    if (!route) throw new NotFoundException('Sell route not found');
    if (route.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');
  }

  async getPaymentRoute(idOrLabel: string, options?: FindOneOptions<Sell>): Promise<Sell> {
    const isRouteId = !isNaN(+idOrLabel);
    const sellRoute = isRouteId
      ? await this.getById(+idOrLabel, options)
      : await this.getByLabel(undefined, idOrLabel, options);

    try {
      this.validateLightningRoute(sellRoute);
    } catch (e) {
      this.logger.verbose(`Failed to validate sell route ${idOrLabel}:`, e);
      throw new NotFoundException(`Payment route not found`);
    }
    return sellRoute;
  }

  async getPaymentLinksFromRoute(
    routeIdOrLabel: string,
    externalIds?: string[],
    ids?: number[],
  ): Promise<PaymentLink[]> {
    const route = await this.getPaymentRoute(routeIdOrLabel, {
      relations: { paymentLinks: true },
      where: {
        paymentLinks: [
          ...(externalIds?.length ? [{ externalId: In(externalIds) }] : []),
          ...(ids?.length ? [{ id: In(ids) }] : []),
        ],
      },
      order: { paymentLinks: { created: 'ASC' } },
    });

    return Array.from(new Map((route.paymentLinks || []).map((l) => [l.id, l])).values());
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

  async createSellPaymentInfo(userId: number, dto: GetSellPaymentInfoDto): Promise<SellPaymentInfoDto> {
    const sell = await Util.retry(
      () => this.createSell(userId, { ...dto, blockchain: dto.asset.blockchain }, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    );
    return this.toPaymentInfoDto(userId, sell, dto);
  }

  async createSellPaymentInfoWithTx(userId: number, dto: GetSellPaymentInfoDto): Promise<SellPaymentInfoWithTxDto> {
    const paymentInfo = await this.createSellPaymentInfo(userId, dto);

    // Only prepare TX if quote is valid
    let unsignedTx: PreparedTxDto | undefined;
    if (paymentInfo.isValid) {
      const request = await this.transactionRequestService.getOrThrow(paymentInfo.id, userId);
      unsignedTx = await this.prepareTx(request);
    }

    return { ...paymentInfo, unsignedTx };
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
    try {
      const route = await this.sellRepo.findOne({
        where: { id: request.routeId },
        relations: { deposit: true, user: { wallet: true, userData: true } },
      });

      const payIn = await this.transactionUtilService.handlePermitInput(route, request, dto);
      const buyFiat = await this.buyFiatService.createFromCryptoInput(payIn, route, request);

      await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_FIAT, route);

      return await this.buyFiatService.extendBuyFiat(buyFiat);
    } catch (e) {
      this.logger.warn(`Failed to execute permit transfer for sell request ${request.id}:`, e);
      throw new BadRequestException(`Failed to execute permit transfer: ${e.message}`);
    }
  }

  async broadcastSell(request: TransactionRequest, dto: BroadcastSellDto): Promise<BuyFiatExtended> {
    try {
      const route = await this.sellRepo.findOne({
        where: { id: request.routeId },
        relations: { deposit: true, user: { wallet: true, userData: true } },
      });

      if (!route) throw new NotFoundException('Sell route not found');

      // Get the asset from the transaction request
      const asset = await this.assetService.getAssetById(request.sourceId);
      if (!asset) throw new BadRequestException('Asset not found');

      // Validate blockchain matches
      if (asset.blockchain !== dto.blockchain) {
        throw new BadRequestException(
          `Blockchain mismatch: expected ${asset.blockchain}, got ${dto.blockchain}`,
        );
      }

      // Calculate expected amount in wei
      const expectedAmountWei = EvmUtil.toWeiAmount(request.amount, asset.decimals);

      // Validate the transaction (recipient and amount)
      this.txValidationService.assertValidEvmTransaction(
        dto.hex,
        route.deposit.address,
        expectedAmountWei,
        asset,
      );

      // Get the blockchain client and broadcast the transaction
      const client = this.blockchainRegistryService.getEvmClient(dto.blockchain);

      // Broadcast the signed transaction
      const txResponse = await client.sendSignedTransaction(dto.hex);

      if (txResponse.error) {
        throw new BadRequestException(`Transaction broadcast failed: ${txResponse.error.message}`);
      }

      const txId = txResponse.response.hash;
      const blockHeight = await client.getCurrentBlock();

      // Parse the transaction to get sender address
      const parsedTx = this.txValidationService.parseEvmTransaction(dto.hex, asset);
      if (!parsedTx) throw new BadRequestException('Failed to parse signed transaction');
      const senderAddress = parsedTx.sender;

      // Create the crypto input (pay-in)
      const [payIn] = await this.payInService.createPayIns([
        {
          senderAddresses: senderAddress,
          receiverAddress: BlockchainAddress.create(route.deposit.address, dto.blockchain),
          txId,
          txType: PayInType.DEPOSIT,
          blockHeight,
          amount: request.amount,
          asset,
        },
      ]);

      // Create the BuyFiat record
      const buyFiat = await this.buyFiatService.createFromCryptoInput(payIn, route, request);

      // Acknowledge the pay-in
      await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_FIAT, route);

      return await this.buyFiatService.extendBuyFiat(buyFiat);
    } catch (e) {
      this.logger.warn(`Failed to broadcast sell transaction for request ${request.id}:`, e);
      throw new BadRequestException(`Failed to broadcast sell transaction: ${e.message}`);
    }
  }

  async prepareTx(request: TransactionRequest): Promise<PreparedTxDto> {
    const route = await this.sellRepo.findOne({
      where: { id: request.routeId },
      relations: { deposit: true },
    });

    if (!route) throw new NotFoundException('Sell route not found');

    const asset = await this.assetService.getAssetById(request.sourceId);
    if (!asset) throw new BadRequestException('Asset not found');

    const chainId = EvmUtil.getChainId(asset.blockchain);
    if (!chainId) throw new BadRequestException(`Unsupported blockchain: ${asset.blockchain}`);

    const userAddress = request.user.address;
    const client = this.blockchainRegistryService.getEvmClient(asset.blockchain);
    const amountWei = EvmUtil.toWeiAmount(request.amount, asset.decimals);
    const depositAddress = route.deposit.address;

    let to: string;
    let data: string;
    let value: string;
    let gasLimitPromise: Promise<string>;

    if (asset.type === AssetType.COIN) {
      // Native token transfer (ETH, MATIC, etc.)
      to = depositAddress;
      data = '0x';
      value = amountWei.toString();
      gasLimitPromise = Promise.resolve('21000');
    } else {
      // ERC20 token transfer
      if (!asset.chainId) throw new BadRequestException('Asset has no contract address');

      to = asset.chainId;
      data = EvmUtil.encodeErc20Transfer(depositAddress, amountWei);
      value = '0';
      gasLimitPromise = client.getTokenGasLimitForAsset(asset).then((g) => g.toString());
    }

    // Fetch nonce, gasPrice, and gasLimit in parallel
    const [nonce, gasPrice, gasLimit] = await Promise.all([
      client.getTransactionCount(userAddress),
      client.getRecommendedGasPrice(),
      gasLimitPromise,
    ]);

    return {
      from: userAddress,
      to,
      data,
      value,
      nonce,
      gasPrice: gasPrice.toString(),
      gasLimit,
      chainId,
      blockchain: asset.blockchain,
      depositAddress,
      amount: request.amount,
      asset: asset.name,
    };
  }

  private async toPaymentInfoDto(userId: number, sell: Sell, dto: GetSellPaymentInfoDto): Promise<SellPaymentInfoDto> {
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

    await this.transactionRequestService.create(TransactionRequestType.SELL, dto, sellDto, user.id);

    return sellDto;
  }

  async getPaymentRoutesForPublicName(publicName: string): Promise<Sell[]> {
    return this.sellRepo.find({
      where: {
        active: true,
        deposit: { blockchains: Blockchain.LIGHTNING },
        user: { userData: { paymentLinksName: publicName } },
      },
      relations: { user: { userData: true } },
    });
  }

  async getPaymentRouteForKey(key: string): Promise<Sell | undefined> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .innerJoin('sell.deposit', 'deposit')
      .innerJoinAndSelect('sell.user', 'user')
      .innerJoinAndSelect('user.userData', 'userData')
      .where(
        `EXISTS (SELECT 1 FROM OPENJSON(userdata.paymentLinksConfig, '$.accessKeys') AS k WHERE k.value = :key )`,
        { key },
      )
      .andWhere('sell.active = 1')
      .andWhere('deposit.blockchains = :chain', { chain: Blockchain.LIGHTNING })
      .getOne();
  }
}
