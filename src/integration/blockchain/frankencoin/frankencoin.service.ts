import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, GetConfig } from 'src/config/config';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { CreateLogDto } from 'src/subdomains/supporting/log/dto/create-log.dto';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EvmUtil } from '../shared/evm/evm.util';
import { FrankencoinBasedService } from '../shared/frankencoin/frankencoin-based.service';
import {
  FrankencoinChallengeGraphDto,
  FrankencoinDelegationGraphDto,
  FrankencoinInfoDto,
  FrankencoinLogDto,
  FrankencoinMinterGraphDto,
  FrankencoinPoolSharesDto,
  FrankencoinPositionDto,
  FrankencoinPositionGraphDto,
  FrankencoinSwapDto,
  FrankencoinTradeGraphDto,
} from './dto/frankencoin.dto';
import { FrankencoinClient } from './frankencoin-client';

@Injectable()
export class FrankencoinService extends FrankencoinBasedService implements OnModuleInit {
  private readonly logger = new DfxLogger(FrankencoinService);

  private static readonly LOG_SYSTEM = 'EvmInformation';
  private static readonly LOG_SUBSYSTEM = 'FrankencoinSmartContract';

  private readonly client: FrankencoinClient;

  private usd: Fiat;
  private chf: Fiat;

  constructor(
    http: HttpService,
    private readonly moduleRef: ModuleRef,
    private readonly logService: LogService,
    private readonly fiatService: FiatService,
  ) {
    super();

    const { zchfGatewayUrl, zchfApiKey } = GetConfig().blockchain.frankencoin;

    this.client = new FrankencoinClient(http, zchfGatewayUrl, zchfApiKey);
  }

  async onModuleInit() {
    this.setup(this.moduleRef.get(PricingService, { strict: false }));

    this.usd = await this.fiatService.getFiatByName('USD');
    this.chf = await this.fiatService.getFiatByName('CHF');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock()
  async processLogInfo() {
    if (DisabledProcess(Process.FRANKENCOIN_LOG_INFO)) return;

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
    const xchfContract = this.client.getErc20Contract(Config.blockchain.frankencoin.contractAddress.xchf);
    const stablecoinBridgeContract = this.client.getStablecoinBridgeContract(
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
    const positions = await this.client.getPositionV1s();
    return this.getPositions(positions);
  }

  async getPositionV2s(): Promise<FrankencoinPositionDto[]> {
    const positions = await this.client.getPositionV2s();
    return this.getPositions(positions);
  }

  private async getPositions(positions: FrankencoinPositionGraphDto[]): Promise<FrankencoinPositionDto[]> {
    const positionsResult: FrankencoinPositionDto[] = [];

    for (const position of positions) {
      try {
        const frankencoinContract = this.client.getFrankencoinContract(position.zchf);

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
    return this.client.getChallengeV1s();
  }

  async getChallengeV2s(): Promise<FrankencoinChallengeGraphDto[]> {
    return this.client.getChallengeV2s();
  }

  async getFPS(): Promise<FrankencoinPoolSharesDto> {
    const equityContract = this.client.getEquityContract(Config.blockchain.frankencoin.contractAddress.equity);
    const frankencoinContract = this.client.getFrankencoinContract(Config.blockchain.frankencoin.contractAddress.zchf);

    const fps = await this.client.getFPS(Config.blockchain.frankencoin.contractAddress.zchf);

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
        totalLosses: EvmUtil.fromWeiAmount(fps.loss),
      };

      return fpsResult;
    } catch (e) {
      this.logger.error(`Error while getting pool shares ${fps.id}`, e);
    }
  }

  private async getTotalSupply(): Promise<number> {
    const frankencoinContract = this.client.getFrankencoinContract(Config.blockchain.frankencoin.contractAddress.zchf);
    const zchfTotalSupply = await frankencoinContract.totalSupply();

    return EvmUtil.fromWeiAmount(zchfTotalSupply);
  }

  async getFPSPrice(): Promise<number> {
    const equityContract = this.client.getEquityContract(Config.blockchain.frankencoin.contractAddress.equity);
    const price = await equityContract.price();

    return EvmUtil.fromWeiAmount(price);
  }

  async getMinters(): Promise<FrankencoinMinterGraphDto[]> {
    return this.client.getMinters();
  }

  async getDelegation(owner: string): Promise<FrankencoinDelegationGraphDto> {
    return this.client.getDelegation(owner);
  }

  async getTrades(): Promise<FrankencoinTradeGraphDto[]> {
    return this.client.getTrades();
  }

  async getTvl(): Promise<number> {
    const positionV1s = await this.client.getPositionV1s();
    const positionV2s = await this.client.getPositionV2s();

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

    const priceUsdToChf = await this.getPrice(this.usd, this.chf);

    return {
      totalSupplyZchf: frankencoinLog.totalSupply,
      totalValueLockedInChf: priceUsdToChf.convert(frankencoinLog.totalValueLocked),
      fpsMarketCapInChf: frankencoinLog.poolShares.marketCap,
    };
  }
}
