import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CronExpression } from '@nestjs/schedule';
import { Contract } from 'ethers';
import { Config, GetConfig } from 'src/config/config';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CreateLogDto } from 'src/subdomains/supporting/log/dto/create-log.dto';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { PriceCurrency, PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CollateralWithTotalBalance } from '../shared/dto/frankencoin-based.dto';
import { EvmUtil } from '../shared/evm/evm.util';
import { FrankencoinBasedService } from '../shared/frankencoin/frankencoin-based.service';
import { BlockchainRegistryService } from '../shared/services/blockchain-registry.service';
import {
  FrankencoinChallengeGraphDto,
  FrankencoinInfoDto,
  FrankencoinLogDto,
  FrankencoinPoolSharesDto,
  FrankencoinPositionDto,
  FrankencoinPositionGraphDto,
  FrankencoinSwapDto,
} from './dto/frankencoin.dto';
import { FrankencoinClient } from './frankencoin-client';

@Injectable()
export class FrankencoinService extends FrankencoinBasedService implements OnModuleInit {
  private static readonly LOG_SYSTEM = 'EvmInformation';
  private static readonly LOG_SUBSYSTEM = 'FrankencoinSmartContract';

  private frankencoinClient: FrankencoinClient;

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
    this.frankencoinClient = new FrankencoinClient(this.getEvmClient());
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.FRANKENCOIN_LOG_INFO })
  async processLogInfo() {
    if (!GetConfig().blockchain.frankencoin.contractAddress.xchf) return;

    const logMessage: FrankencoinLogDto = {
      swap: await this.getSwap(),
      positionV1s: await this.getPositionV1s(),
      positionV2s: await this.getPositionV2s(),
      poolShares: await this.getFPS(),
      totalSupply: await this.getTotalSupply(),
      totalValueLocked: await this.getTvl(),
    };

    const log: CreateLogDto = {
      system: FrankencoinService.LOG_SYSTEM,
      subsystem: FrankencoinService.LOG_SUBSYSTEM,
      severity: LogSeverity.INFO,
      message: JSON.stringify(logMessage),
      valid: null,
      category: null,
    };

    await this.logService.create(log);
  }

  async getSwap(): Promise<FrankencoinSwapDto> {
    const xchfContract = this.frankencoinClient.getErc20Contract(Config.blockchain.frankencoin.contractAddress.xchf);
    const stablecoinBridgeContract = this.frankencoinClient.getStablecoinBridgeContract(
      Config.blockchain.frankencoin.contractAddress.stablecoinBridge,
    );

    const stablecoinBridgeBalance = await xchfContract.balanceOf(
      Config.blockchain.frankencoin.contractAddress.stablecoinBridge,
    );
    const stablecoinBridgeLimit = await stablecoinBridgeContract.limit();

    return {
      xchfSwapLimit: EvmUtil.fromWeiAmount(stablecoinBridgeLimit) - EvmUtil.fromWeiAmount(stablecoinBridgeBalance),
      zchfSwapLimit: EvmUtil.fromWeiAmount(stablecoinBridgeBalance),
    };
  }

  async getPositionV1s(): Promise<FrankencoinPositionDto[]> {
    const positions = await this.frankencoinClient.getPositionV1s();
    return this.getPositions(positions);
  }

  async getPositionV2s(): Promise<FrankencoinPositionDto[]> {
    const positions = await this.frankencoinClient.getPositionV2s();
    return this.getPositions(positions);
  }

  private async getPositions(positions: FrankencoinPositionGraphDto[]): Promise<FrankencoinPositionDto[]> {
    const positionsResult: FrankencoinPositionDto[] = [];

    for (const position of positions) {
      try {
        const frankencoinContract = this.frankencoinClient.getFrankencoinContract(position.zchf);

        const calculateAssignedReserve = await frankencoinContract.calculateAssignedReserve(
          position.minted,
          position.reserveContribution,
        );

        positionsResult.push({
          address: {
            position: position.position,
            frankencoin: position.zchf,
            collateral: position.collateral,
            owner: position.owner,
          },
          collateral: {
            symbol: position.collateralSymbol,
            amount: EvmUtil.fromWeiAmount(position.collateralBalance, position.collateralDecimals),
          },
          details: {
            availableAmount: EvmUtil.fromWeiAmount(position.availableForClones),
            totalBorrowed: EvmUtil.fromWeiAmount(position.minted),
            liquidationPrice: EvmUtil.fromWeiAmount(position.price, 36 - position.collateralDecimals),
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

  async getChallengeV1s(): Promise<FrankencoinChallengeGraphDto[]> {
    return this.frankencoinClient.getChallengeV1s();
  }

  async getChallengeV2s(): Promise<FrankencoinChallengeGraphDto[]> {
    return this.frankencoinClient.getChallengeV2s();
  }

  async getFPS(): Promise<FrankencoinPoolSharesDto> {
    const equityContract = this.getEquityContract();

    const frankencoinContract = this.frankencoinClient.getFrankencoinContract(
      Config.blockchain.frankencoin.contractAddress.zchf,
    );

    const fps = await this.frankencoinClient.getFPS();

    try {
      const totalSupply = await equityContract.totalSupply();
      const price = await equityContract.price();
      const frankenMinterReserve = await frankencoinContract.minterReserve();
      const frankenEquity = await frankencoinContract.equity();

      const fpsResult: FrankencoinPoolSharesDto = {
        fpsPrice: EvmUtil.fromWeiAmount(price),
        supply: EvmUtil.fromWeiAmount(totalSupply),
        marketCap: EvmUtil.fromWeiAmount(totalSupply) * EvmUtil.fromWeiAmount(price),
        totalReserve: EvmUtil.fromWeiAmount(frankenMinterReserve) + EvmUtil.fromWeiAmount(frankenEquity),
        equityCapital: EvmUtil.fromWeiAmount(frankenEquity),
        minterReserve: EvmUtil.fromWeiAmount(frankenMinterReserve),
        totalIncome: EvmUtil.fromWeiAmount(fps.profits),
        totalLosses: EvmUtil.fromWeiAmount(fps.losses),
      };

      return fpsResult;
    } catch (e) {
      this.logger.error(`Error while getting pool shares`, e);
    }
  }

  private async getTotalSupply(): Promise<number> {
    const frankencoinContract = this.frankencoinClient.getFrankencoinContract(
      Config.blockchain.frankencoin.contractAddress.zchf,
    );
    const zchfTotalSupply = await frankencoinContract.totalSupply();

    return EvmUtil.fromWeiAmount(zchfTotalSupply);
  }

  getWalletAddress(): string {
    return this.frankencoinClient.walletAddress;
  }

  getEquityContract(): Contract {
    return this.frankencoinClient.getEquityContract(Config.blockchain.frankencoin.contractAddress.equity);
  }

  async getEquityPrice(): Promise<number> {
    return this.getFPSPrice();
  }

  getWrapperContract(): Contract {
    return this.frankencoinClient.getFPSWrapperContract(Config.blockchain.frankencoin.contractAddress.fpsWrapper);
  }

  async getFPSPrice(): Promise<number> {
    const equityContract = this.getEquityContract();
    const price = await equityContract.price();

    return EvmUtil.fromWeiAmount(price);
  }

  async getTvl(): Promise<number> {
    const positionV1s = await this.frankencoinClient.getPositionV1s();
    const positionV2s = await this.frankencoinClient.getPositionV2s();

    const collaterals = [...positionV1s, ...positionV2s].map((p) => {
      return {
        collateral: p.collateral,
        collateralSymbol: p.collateralSymbol,
        collateralBalance: p.collateralBalance,
        collateralDecimals: p.collateralDecimals,
      };
    });

    return this.getTvlByCollaterals(collaterals);
  }

  async getCustomCollateralPrice(_: CollateralWithTotalBalance): Promise<number | undefined> {
    return;
  }

  async getFrankencoinInfo(): Promise<FrankencoinInfoDto> {
    const maxFrankencoinLogEntity = await this.logService.maxEntity(
      FrankencoinService.LOG_SYSTEM,
      FrankencoinService.LOG_SUBSYSTEM,
      LogSeverity.INFO,
    );

    if (!maxFrankencoinLogEntity) {
      return {
        totalSupplyZchf: 0,
        totalValueLockedInChf: 0,
        fpsMarketCapInChf: 0,
      };
    }

    const frankencoinLog = <FrankencoinLogDto>JSON.parse(maxFrankencoinLogEntity.message);

    const priceUsdToChf = await this.getPrice(PriceCurrency.USD, PriceCurrency.CHF);

    return {
      totalSupplyZchf: frankencoinLog.totalSupply,
      totalValueLockedInChf: priceUsdToChf.convert(frankencoinLog.totalValueLocked),
      fpsMarketCapInChf: frankencoinLog.poolShares.marketCap,
    };
  }
}
