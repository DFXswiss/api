import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { ConfirmDto } from 'src/subdomains/core/sell-crypto/route/dto/confirm.dto';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  TransactionRequest,
  TransactionRequestType,
} from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { In, IsNull, Like, Not } from 'typeorm';
import { DepositService } from '../../../../supporting/address-pool/deposit/deposit.service';
import { BuyCryptoWebhookService } from '../../process/services/buy-crypto-webhook.service';
import { BuyCryptoService } from '../../process/services/buy-crypto.service';
import { GetSwapPaymentInfoDto } from './dto/get-swap-payment-info.dto';
import { SwapPaymentInfoDto } from './dto/swap-payment-info.dto';
import { UpdateSwapDto } from './dto/update-swap.dto';
import { Swap } from './swap.entity';
import { SwapRepository } from './swap.repository';

@Injectable()
export class SwapService {
  private readonly logger = new DfxLogger(SwapService);

  constructor(
    private readonly swapRepo: SwapRepository,
    private readonly userService: UserService,
    private readonly depositService: DepositService,
    private readonly userDataService: UserDataService,
    private readonly assetService: AssetService,
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    @Inject(forwardRef(() => TransactionUtilService))
    private readonly transactionUtilService: TransactionUtilService,
    private readonly routeService: RouteService,
    @Inject(forwardRef(() => TransactionHelper))
    private readonly transactionHelper: TransactionHelper,
    private readonly cryptoService: CryptoService,
    @Inject(forwardRef(() => TransactionRequestService))
    private readonly transactionRequestService: TransactionRequestService,
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly eip7702DelegationService: Eip7702DelegationService,
  ) {}

  async getSwapByAddress(depositAddress: string): Promise<Swap> {
    // does not work with find options
    return this.swapRepo
      .createQueryBuilder('crypto')
      .leftJoinAndSelect('crypto.deposit', 'deposit')
      .leftJoinAndSelect('crypto.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .where('deposit.address = :addr', { addr: depositAddress })
      .getOne();
  }

  // --- VOLUMES --- //
  @DfxCron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.swapRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(swapId: number, volume: number, annualVolume: number): Promise<void> {
    await this.swapRepo.update(swapId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.swapRepo.findOne({
      where: { id: swapId },
      relations: { user: true },
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateCryptoVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.swapRepo
      .createQueryBuilder('crypto')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.swapRepo
      .createQueryBuilder('crypto')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  async getSwapWithoutRoute(): Promise<Swap[]> {
    return this.swapRepo.findBy({ route: { id: IsNull() } });
  }

  // --- SWAPS --- //
  async get(userId: number, id: number): Promise<Swap> {
    const swap = await this.swapRepo.findOne({ where: { id, user: { id: userId } }, relations: { user: true } });
    if (!swap) throw new NotFoundException('Swap not found');
    return swap;
  }

  async getSwapByKey(key: string, value: any, onlyDefaultRelation = false): Promise<Swap> {
    const query = this.swapRepo
      .createQueryBuilder('swap')
      .select('swap')
      .leftJoinAndSelect('swap.deposit', 'deposit')
      .leftJoinAndSelect('swap.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .where(`${key.includes('.') ? key : `swap.${key}`} = :param`, { param: value });

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

  async getAllUserSwaps(userIds: number[]): Promise<Swap[]> {
    return this.swapRepo.find({
      where: { user: { id: In(userIds) } },
      relations: { user: true },
      order: { id: 'DESC' },
    });
  }

  async createSwapPaymentInfo(
    userId: number,
    dto: GetSwapPaymentInfoDto,
    includeTx = false,
  ): Promise<SwapPaymentInfoDto> {
    const swap = await Util.retry(
      () => this.createSwap(userId, dto.sourceAsset.blockchain, dto.targetAsset, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    );
    return this.toPaymentInfoDto(userId, swap, dto, includeTx);
  }

  async getById(id: number): Promise<Swap> {
    return this.swapRepo.findOne({ where: { id } });
  }

  async createSwap(userId: number, blockchain: Blockchain, asset: Asset, ignoreException = false): Promise<Swap> {
    // KYC check
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (userData.status !== UserDataStatus.ACTIVE && userData.kycLevel < KycLevel.LEVEL_30 && !ignoreException)
      throw new BadRequestException('User not allowed for swap trading');

    // check if exists
    const existing = await this.swapRepo.findOne({
      where: {
        asset: { id: asset.id },
        targetDeposit: IsNull(),
        user: { id: userId },
        deposit: { blockchains: Like(`%${blockchain}%`) },
      },
      relations: { deposit: true, user: true },
    });

    if (existing) {
      if (existing.active && !ignoreException) throw new ConflictException('Swap route already exists');

      if (!existing.active && (userData.status === UserDataStatus.ACTIVE || userData.kycLevel >= KycLevel.LEVEL_30)) {
        // reactivate deleted route
        existing.active = true;
        await this.swapRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const swap = this.swapRepo.create({ asset });
    swap.user = await this.userService.getUser(userId);
    swap.route = await this.routeService.createRoute({ swap });
    swap.deposit = await this.depositService.getNextDeposit(blockchain);

    // save
    return this.swapRepo.save(swap);
  }

  async getUserSwaps(userId: number): Promise<Swap[]> {
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (!userData.hasBankTxVerification) return [];

    return this.swapRepo.find({
      where: { user: { id: userId }, asset: { buyable: true }, active: true },
      relations: { user: true },
    });
  }

  async updateSwap(userId: number, swapId: number, dto: UpdateSwapDto): Promise<Swap> {
    const swap = await this.swapRepo.findOneBy({ id: swapId, user: { id: userId } });
    if (!swap) throw new NotFoundException('Swap route not found');

    return this.swapRepo.save({ ...swap, ...dto });
  }

  // --- CONFIRMATION --- //
  async confirmSwap(request: TransactionRequest, dto: ConfirmDto): Promise<BuyCryptoExtended> {
    const route = await this.swapRepo.findOne({
      where: { id: request.routeId },
      relations: { deposit: true, user: { wallet: true, userData: true } },
    });
    if (!route) throw new NotFoundException('Swap route not found');

    let type: string;
    let payIn;

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

      const buyCrypto = await this.buyCryptoService.createFromCryptoInput(payIn, route, request);
      await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_CRYPTO, route);
      return await this.buyCryptoWebhookService.extendBuyCrypto(buyCrypto);
    } catch (e) {
      this.logger.warn(`Failed to execute ${type} transfer for swap request ${request.id}:`, e);
      throw new BadRequestException(`Failed to confirm request: ${e.message}`);
    }
  }

  //*** GETTERS ***//

  getSwapRepo(): SwapRepository {
    return this.swapRepo;
  }

  async createDepositTx(request: TransactionRequest, route: Swap): Promise<any> {
    const asset = await this.assetService.getAssetById(request.sourceId);
    if (!asset) throw new BadRequestException('Asset not found');

    const client = this.blockchainRegistryService.getEvmClient(asset.blockchain);
    if (!client) throw new BadRequestException(`Unsupported blockchain`);

    const userAddress = request.user?.address;
    if (!userAddress) throw new BadRequestException('User address not found in transaction request');

    const depositAddress = route.deposit.address;

    // Check if EIP-7702 delegation is supported and user has zero native balance
    const supportsEip7702 = this.eip7702DelegationService.isDelegationSupported(asset.blockchain);
    let hasZeroGas = false;

    if (supportsEip7702) {
      try {
        hasZeroGas = await this.eip7702DelegationService.hasZeroNativeBalance(userAddress, asset.blockchain);
      } catch (_) {
        // If balance check fails (RPC error, network issue, etc.), assume user has gas
        this.logger.verbose(`Balance check failed for ${userAddress} on ${asset.blockchain}, assuming user has gas`);
        hasZeroGas = false;
      }
    }

    try {
      const unsignedTx = await client.prepareTransaction(asset, userAddress, depositAddress, request.amount);

      // Add EIP-7702 delegation data if user has 0 gas
      if (hasZeroGas) {
        this.logger.info(`User ${userAddress} has 0 gas on ${asset.blockchain}, providing EIP-7702 delegation data`);
        const delegationData = await this.eip7702DelegationService.prepareDelegationData(userAddress, asset.blockchain);

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
          `Gas estimation failed due to insufficient funds for user ${userAddress}, creating transaction with EIP-7702 delegation`,
        );

        // Create a basic unsigned transaction without gas estimation
        // The actual gas will be paid by the relayer through EIP-7702 delegation
        const delegationData = await this.eip7702DelegationService.prepareDelegationData(userAddress, asset.blockchain);

        const unsignedTx = {
          chainId: client.chainId,
          from: userAddress,
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
      this.logger.warn(`Failed to create deposit TX for swap request ${request.id}:`, e);
      throw new BadRequestException(`Failed to create deposit transaction: ${e.reason ?? e.message}`);
    }
  }

  private async toPaymentInfoDto(
    userId: number,
    swap: Swap,
    dto: GetSwapPaymentInfoDto,
    includeTx: boolean,
  ): Promise<SwapPaymentInfoDto> {
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
      dto.sourceAsset,
      dto.targetAsset,
      CryptoPaymentMethod.CRYPTO,
      CryptoPaymentMethod.CRYPTO,
      dto.exactPrice,
      user,
    );

    const swapDto: SwapPaymentInfoDto = {
      id: 0, // set during request creation
      timestamp,
      routeId: swap.id,
      fee: Util.round(feeSource.rate * 100, Config.defaultPercentageDecimal),
      depositAddress: swap.active ? swap.deposit.address : undefined,
      blockchain: dto.sourceAsset.blockchain,
      minDeposit: { amount: minVolume, asset: dto.sourceAsset.dexName },
      minVolume,
      minFee: feeSource.min,
      minVolumeTarget,
      minFeeTarget: feeTarget.min,
      fees: feeSource,
      feesTarget: feeTarget,
      exchangeRate,
      rate,
      exactPrice,
      priceSteps,
      estimatedAmount,
      amount,
      targetAsset: AssetDtoMapper.toDto(dto.targetAsset),
      sourceAsset: AssetDtoMapper.toDto(dto.sourceAsset),
      maxVolume,
      maxVolumeTarget,
      paymentRequest: swap.active
        ? await this.cryptoService.getPaymentRequest(isValid, dto.sourceAsset, swap.deposit.address, amount)
        : undefined,
      isValid,
      error,
    };

    const transactionRequest = await this.transactionRequestService.create(
      TransactionRequestType.SWAP,
      dto,
      swapDto,
      user.id,
    );

    // Assign complete user object to ensure user.address is available for createDepositTx
    transactionRequest.user = user;

    if (includeTx && isValid) {
      swapDto.depositTx = await this.createDepositTx(transactionRequest, swap);
    }

    return swapDto;
  }
}
