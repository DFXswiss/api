import { FeeAmount } from '@uniswap/v3-sdk';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CronExpression } from '@nestjs/schedule';
import { Contract } from 'ethers';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CreateLogDto } from 'src/subdomains/supporting/log/dto/create-log.dto';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CitreaClient } from '../citrea/citrea-client';
import { CollateralWithTotalBalance } from '../shared/dto/frankencoin-based.dto';
import { Blockchain } from '../shared/enums/blockchain.enum';
import { EvmClient } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { FrankencoinBasedService } from '../shared/frankencoin/frankencoin-based.service';
import { BlockchainRegistryService } from '../shared/services/blockchain-registry.service';
import {
  JuiceBridgeLogDto,
  JuiceInfoDto,
  JuiceLogDto,
  JuicePoolSharesDto,
  JuicePositionDto,
  JuicePositionGraphDto,
  JuiceSavingsInfoDto,
  JuiceSavingsLogDto,
} from './dto/juice.dto';
import { JuiceClient } from './juice-client';

@Injectable()
export class JuiceService extends FrankencoinBasedService implements OnModuleInit {
  private static readonly LOG_SYSTEM = 'EvmInformation';
  private static readonly LOG_SUBSYSTEM = 'JuiceSmartContract';

  private juiceClient: JuiceClient;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly logService: LogService,
  ) {
    super();
  }

  onModuleInit() {
    this.setup(
      this.moduleRef.get(PricingService, { strict: false }),
      this.moduleRef.get(BlockchainRegistryService, { strict: false }),
    );

    this.juiceClient = new JuiceClient(this.getEvmClient());
  }

  // Override to use Citrea instead of Ethereum
  getEvmClient(): EvmClient {
    return this.registryService.getClient(Blockchain.CITREA) as EvmClient;
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.JUICE_LOG_INFO })
  async processLogInfo(): Promise<void> {
    if (!Config.blockchain.juice.graphUrl) {
      this.logger.warn('Juice graphUrl not configured - skipping processLogInfo');
      return;
    }

    const collateralTvl = await this.getCollateralTvl();
    const bridgeTvl = await this.getBridgeTvl();
    const totalValueLocked = collateralTvl + bridgeTvl;

    const positionV2s = await this.getPositionV2s();
    const totalBorrowed = Util.sum(positionV2s.map((p) => p.details.totalBorrowed));

    const logMessage: JuiceLogDto = {
      positionV2s,
      poolShares: await this.getJuice(),
      savings: await this.getSavingsLogInfo(),
      bridges: await this.getBridgeLogInfo(),
      totalSupply: await this.getTotalSupply(),
      totalValueLocked,
      totalBorrowed,
    };

    const log: CreateLogDto = {
      system: JuiceService.LOG_SYSTEM,
      subsystem: JuiceService.LOG_SUBSYSTEM,
      severity: LogSeverity.INFO,
      message: JSON.stringify(logMessage),
      valid: null,
      category: null,
    };

    await this.logService.create(log);
  }

  async getPositionV2s(): Promise<JuicePositionDto[]> {
    const positions = await this.juiceClient.getPositionV2s();
    return this.getPositions(positions);
  }

  private async getPositions(positions: JuicePositionGraphDto[]): Promise<JuicePositionDto[]> {
    const positionsResult: JuicePositionDto[] = [];

    for (const position of positions) {
      try {
        const jusdContract = this.juiceClient.getJusdContract();
        const calculateAssignedReserve = await jusdContract.calculateAssignedReserve(
          position.principal,
          position.reserveContribution,
        );

        const positionContract = this.juiceClient.getPositionContract(position.id);
        const virtualPrice = await positionContract.virtualPrice();

        positionsResult.push({
          address: {
            position: position.position,
            jusd: position.jusd,
            collateral: position.collateral,
            owner: position.owner,
          },
          collateral: {
            symbol: position.collateralSymbol,
            amount: EvmUtil.fromWeiAmount(position.collateralBalance, position.collateralDecimals),
          },
          details: {
            availableAmount: EvmUtil.fromWeiAmount(position.availableForClones),
            totalBorrowed: EvmUtil.fromWeiAmount(position.principal),
            liquidationPrice: EvmUtil.fromWeiAmount(position.price, 36 - position.collateralDecimals),
            virtualPrice: EvmUtil.fromWeiAmount(virtualPrice, 36 - position.collateralDecimals),
            retainedReserve: EvmUtil.fromWeiAmount(calculateAssignedReserve),
            limit: EvmUtil.fromWeiAmount(position.limitForClones),
            expirationDate: new Date(Number(position.expiration) * 1000),
          },
        });
      } catch (e) {
        this.logger.error(`Error while getting position ${position.position}`, e);
      }
    }

    return positionsResult;
  }

  async getJuice(): Promise<JuicePoolSharesDto> {
    const equityContract = this.getEquityContract();
    const jusdContract = this.juiceClient.getJusdContract();
    const juice = await this.juiceClient.getJuice();

    try {
      const totalSupply = await equityContract.totalSupply();
      const price = await equityContract.price();
      const jusdMinterReserve = await jusdContract.minterReserve();
      const jusdEquity = await jusdContract.equity();

      const juiceResult: JuicePoolSharesDto = {
        juicePrice: EvmUtil.fromWeiAmount(price),
        supply: EvmUtil.fromWeiAmount(totalSupply),
        marketCap: EvmUtil.fromWeiAmount(totalSupply) * EvmUtil.fromWeiAmount(price),
        totalReserve: EvmUtil.fromWeiAmount(jusdMinterReserve) + EvmUtil.fromWeiAmount(jusdEquity),
        equityCapital: EvmUtil.fromWeiAmount(jusdEquity),
        minterReserve: EvmUtil.fromWeiAmount(jusdMinterReserve),
        totalIncome: EvmUtil.fromWeiAmount(juice?.profits ?? '0x0'),
        totalLosses: EvmUtil.fromWeiAmount(juice?.loss ?? '0x0'),
      };

      return juiceResult;
    } catch (e) {
      this.logger.error(`Error while getting pool shares ${juice?.id ?? 0}`, e);
    }
  }

  private async getTotalSupply(): Promise<number> {
    const jusdContract = this.juiceClient.getJusdContract();
    const jusdTotalSupply = await jusdContract.totalSupply();

    return EvmUtil.fromWeiAmount(jusdTotalSupply);
  }

  getWalletAddress(): string {
    return this.juiceClient.getWalletAddress();
  }

  getEquityContract(): Contract {
    return this.juiceClient.getEquityContract();
  }

  getWrapperContract(): Contract {
    return null;
  }

  async getEquityPrice(): Promise<number> {
    return this.getJuicePrice();
  }

  async getCustomCollateralPrice(_collateral: CollateralWithTotalBalance): Promise<number | undefined> {
    return undefined;
  }

  async getJuicePrice(): Promise<number> {
    const equityContract = this.getEquityContract();
    const price = await equityContract.price();

    return EvmUtil.fromWeiAmount(price);
  }

  async getCollateralTvl(): Promise<number> {
    const positionV2s = await this.juiceClient.getPositionV2s();

    const collaterals = positionV2s.map((p) => {
      return {
        collateral: p.collateral,
        collateralSymbol: p.collateralSymbol,
        collateralBalance: p.collateralBalance,
        collateralDecimals: p.collateralDecimals,
      };
    });

    return this.getTvlByCollaterals(collaterals);
  }

  async getBridgeTvl(): Promise<number> {
    const bridgeContracts = this.juiceClient.getBridgeContracts();

    let tvl = 0;

    for (const bridgeContract of bridgeContracts) {
      const minted = await bridgeContract.minted();
      tvl += EvmUtil.fromWeiAmount(minted);
    }

    return tvl;
  }

  async getSavingsLogInfo(): Promise<JuiceSavingsLogDto> {
    return this.juiceClient.getSavingsInfo().then((s) => this.mapSavingsInfo(s));
  }

  private mapSavingsInfo(savingsInfo: JuiceSavingsInfoDto): JuiceSavingsLogDto {
    return {
      totalSaved: savingsInfo.totalSaved,
      totalBalance: savingsInfo.totalBalance,
    };
  }

  async getBridgeLogInfo(): Promise<JuiceBridgeLogDto[]> {
    const bridgeLogInfo: JuiceBridgeLogDto[] = [];

    const bridgeContracts = this.juiceClient.getBridgeContracts();

    for (const bridgeContract of bridgeContracts) {
      const minted = await bridgeContract.minted();
      const stablecoinAddress = await bridgeContract.usd();

      const stablecoinContract = this.juiceClient.getErc20Contract(stablecoinAddress);
      const symbol = await stablecoinContract.symbol();

      bridgeLogInfo.push({ symbol, minted: EvmUtil.fromWeiAmount(minted) });
    }

    return bridgeLogInfo;
  }

  async bridgeToJusd(asset: Asset, amount: number): Promise<string> {
    return this.juiceClient.bridgeToJusd(asset, amount);
  }

  async swapViaGateway(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
    minAmountOut: number,
    fee: FeeAmount = FeeAmount.MEDIUM,
  ): Promise<string> {
    const client = this.getEvmClient() as CitreaClient;
    return client.swapViaGateway(
      tokenIn.chainId,
      tokenOut.chainId,
      amountIn,
      minAmountOut,
      fee,
      tokenIn.decimals,
      tokenOut.decimals,
    );
  }

  async getGatewayTokenAddresses(): Promise<{ jusd: string; svJusd: string; wcbtc: string }> {
    const client = this.getEvmClient() as CitreaClient;
    return client.getGatewayTokenAddresses();
  }

  async getGatewayDefaultFee(): Promise<number> {
    const client = this.getEvmClient() as CitreaClient;
    return client.getGatewayDefaultFee();
  }

  async getJuiceInfo(): Promise<JuiceInfoDto> {
    const maxJuiceLogEntity = await this.logService.maxEntity(
      JuiceService.LOG_SYSTEM,
      JuiceService.LOG_SUBSYSTEM,
      LogSeverity.INFO,
    );

    if (!maxJuiceLogEntity) {
      return {
        totalSupplyJusd: 0,
        totalValueLockedInUsd: 0,
        juiceMarketCapInUsd: 0,
      };
    }

    const juiceLog = <JuiceLogDto>JSON.parse(maxJuiceLogEntity.message);

    return {
      totalSupplyJusd: juiceLog.totalSupply,
      totalValueLockedInUsd: juiceLog.totalValueLocked,
      juiceMarketCapInUsd: juiceLog.poolShares.marketCap,
    };
  }
}
