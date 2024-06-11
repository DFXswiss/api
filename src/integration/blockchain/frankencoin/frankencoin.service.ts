import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, GetConfig } from 'src/config/config';
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
import {
  FrankencoinChallengeGraphDto,
  FrankencoinDelegationGraphDto,
  FrankencoinInfoDto,
  FrankencoinLogDto,
  FrankencoinMinterGraphDto,
  FrankencoinPoolSharesDto,
  FrankencoinPositionDto,
  FrankencoinSwapDto,
  FrankencoinTradeGraphDto,
} from './dto/frankencoin.dto';
import { FrankencoinClient } from './frankencoin-client';

@Injectable()
export class FrankencoinService implements OnModuleInit {
  private readonly logger = new DfxLogger(FrankencoinService);

  private static readonly LOG_SYSTEM = 'EvmInformation';
  private static readonly LOG_SUBSYSTEM = 'FrankencoinSmartContract';

  private readonly client: FrankencoinClient;

  private pricingService: PricingService;

  constructor(
    http: HttpService,
    private readonly moduleRef: ModuleRef,
    private readonly logService: LogService,
    private readonly fiatService: FiatService,
  ) {
    const { zchfGatewayUrl, zchfApiKey } = GetConfig().blockchain.frankencoin;

    this.client = new FrankencoinClient(http, zchfGatewayUrl, zchfApiKey);
  }

  async onModuleInit() {
    this.pricingService = this.moduleRef.get(PricingService, { strict: false });
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock()
  async processLogInfo() {
    if (DisabledProcess(Process.FRANKENCOIN_LOG_INFO)) return;

    const logMessage: FrankencoinLogDto = {
      swap: await this.getSwap(),
      positions: await this.getPositions(),
      poolShares: await this.getFPS(),
      totalSupply: await this.getTotalSupply(),
      totalValueLocked: await this.getTvl(),
    };

    const log: CreateLogDto = {
      system: FrankencoinService.LOG_SYSTEM,
      subsystem: FrankencoinService.LOG_SUBSYSTEM,
      severity: LogSeverity.INFO,
      message: JSON.stringify(logMessage),
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

  async getPositions(): Promise<FrankencoinPositionDto[]> {
    const positionsResult: FrankencoinPositionDto[] = [];

    const positions = await this.client.getPositions();

    for (const position of positions) {
      try {
        const collateralContract = this.client.getErc20Contract(position.collateral);

        const symbol = await collateralContract.symbol();
        const decimals = await collateralContract.decimals();
        const positionBalance = await collateralContract.balanceOf(position.position);

        const positionContract = this.client.getPositionContract(position.position);
        const frankencoinContract = this.client.getFrankencoinContract(position.zchf);

        const price = await positionContract.price();
        const limitForClones = await positionContract.limitForClones();
        const minted = await positionContract.minted();
        const reserveContribution = await positionContract.reserveContribution();
        const calculateAssignedReserve = await frankencoinContract.calculateAssignedReserve(
          minted,
          Number(reserveContribution),
        );
        const limit = await positionContract.limit();
        const expiration = await positionContract.expiration();

        positionsResult.push({
          address: {
            position: position.position,
            frankencoin: position.zchf,
            collateral: position.collateral,
            owner: position.owner,
          },
          collateral: {
            symbol: symbol,
            amount: EvmUtil.fromWeiAmount(positionBalance, decimals),
          },
          details: {
            availableAmount: EvmUtil.fromWeiAmount(limitForClones),
            totalBorrowed: EvmUtil.fromWeiAmount(minted),
            liquidationPrice: EvmUtil.fromWeiAmount(price, 36 - decimals),
            retainedReserve: EvmUtil.fromWeiAmount(calculateAssignedReserve),
            limit: EvmUtil.fromWeiAmount(limit),
            expirationDate: new Date(Number(expiration) * 1000),
          },
        });
      } catch (e) {
        this.logger.error(`Error while getting position ${position.position}`, e);
      }
    }

    return positionsResult;
  }

  async getChallenges(): Promise<FrankencoinChallengeGraphDto[]> {
    return this.client.getChallenges();
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
    return this.client.getTvl();
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

    const fiatUsd = await this.fiatService.getFiatByName('USD');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    const priceUsdToChf = await this.pricingService.getPrice(fiatUsd, fiatChf, false);

    return {
      totalSupplyZchf: frankencoinLog.totalSupply,
      totalValueLockedInChf: frankencoinLog.totalValueLocked / priceUsdToChf.price,
      fpsMarketCapInChf: frankencoinLog.poolShares.marketCap,
    };
  }
}
