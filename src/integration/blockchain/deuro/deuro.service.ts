import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GetConfig } from 'src/config/config';
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
import { DEuroClient } from './deuro-client';
import {
  DEuroInfoDto,
  DEuroLogDto,
  DEuroPoolSharesDto,
  DEuroPositionDto,
  DEuroPositionGraphDto,
} from './dto/deuro.dto';

@Injectable()
export class DEuroService extends FrankencoinBasedService implements OnModuleInit {
  private readonly logger = new DfxLogger(DEuroService);

  private static readonly LOG_SYSTEM = 'EvmInformation';
  private static readonly LOG_SUBSYSTEM = 'DEuroSmartContract';

  private readonly client: DEuroClient;

  private usd: Fiat;
  private eur: Fiat;

  private readonly chainId: number;

  constructor(
    http: HttpService,
    private readonly moduleRef: ModuleRef,
    private readonly logService: LogService,
    private readonly fiatService: FiatService,
  ) {
    super();

    const { deuroGatewayUrl, deuroApiKey, deuroChainId } = GetConfig().blockchain.deuro;

    this.client = new DEuroClient(http, deuroGatewayUrl, deuroApiKey);
    this.chainId = deuroChainId;
  }

  async onModuleInit() {
    this.setup(this.moduleRef.get(PricingService, { strict: false }));

    this.usd = await this.fiatService.getFiatByName('USD');
    this.eur = await this.fiatService.getFiatByName('EUR');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock()
  async processLogInfo(): Promise<void> {
    if (DisabledProcess(Process.DEURO_LOG_INFO)) return;

    const logMessage: DEuroLogDto = {
      positionV2s: await this.getPositionV2s(),
      poolShares: await this.getDEPS(),
      totalSupply: await this.getTotalSupply(),
      totalValueLocked: await this.getTvl(),
    };

    const log: CreateLogDto = {
      system: DEuroService.LOG_SYSTEM,
      subsystem: DEuroService.LOG_SUBSYSTEM,
      severity: LogSeverity.INFO,
      message: JSON.stringify(logMessage),
      valid: null,
      category: null,
    };

    await this.logService.create(log);
  }

  async getPositionV2s(): Promise<DEuroPositionDto[]> {
    const positions = await this.client.getPositionV2s();
    return this.getPositions(positions);
  }

  private async getPositions(positions: DEuroPositionGraphDto[]): Promise<DEuroPositionDto[]> {
    const positionsResult: DEuroPositionDto[] = [];

    for (const position of positions) {
      try {
        const deuroContract = this.client.getDEuroContract(this.chainId);

        const calculateAssignedReserve = await deuroContract.calculateAssignedReserve(
          position.minted,
          position.reserveContribution,
        );

        positionsResult.push({
          address: {
            position: position.position,
            deuro: position.deuro,
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

  async getDEPS(): Promise<DEuroPoolSharesDto> {
    const equityContract = this.client.getEquityContract(this.chainId);
    const deuroContract = this.client.getDEuroContract(this.chainId);

    const deps = await this.client.getDEPS(this.chainId);

    try {
      const totalSupply = await equityContract.totalSupply();
      const price = await equityContract.price();
      const deuroMinterReserve = await deuroContract.minterReserve();
      const deuroEquity = await deuroContract.equity();

      const depsResult: DEuroPoolSharesDto = {
        depsPrice: EvmUtil.fromWeiAmount(price),
        supply: EvmUtil.fromWeiAmount(totalSupply),
        marketCap: EvmUtil.fromWeiAmount(totalSupply) * EvmUtil.fromWeiAmount(price),
        totalReserve: EvmUtil.fromWeiAmount(deuroMinterReserve) + EvmUtil.fromWeiAmount(deuroEquity),
        equityCapital: EvmUtil.fromWeiAmount(deuroEquity),
        minterReserve: EvmUtil.fromWeiAmount(deuroMinterReserve),
        totalIncome: EvmUtil.fromWeiAmount(deps?.profits ?? '0x0'),
        totalLosses: EvmUtil.fromWeiAmount(deps?.loss ?? '0x0'),
      };

      return depsResult;
    } catch (e) {
      this.logger.error(`Error while getting pool shares ${deps?.id ?? 0}`, e);
    }
  }

  private async getTotalSupply(): Promise<number> {
    const deuroContract = this.client.getDEuroContract(this.chainId);
    const deuroTotalSupply = await deuroContract.totalSupply();

    return EvmUtil.fromWeiAmount(deuroTotalSupply);
  }

  async getTvl(): Promise<number> {
    const positionV2s = await this.client.getPositionV2s();

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

  async getDEuroInfo(): Promise<DEuroInfoDto> {
    const maxDEuroLogEntity = await this.logService.maxEntity(
      DEuroService.LOG_SYSTEM,
      DEuroService.LOG_SUBSYSTEM,
      LogSeverity.INFO,
    );

    if (!maxDEuroLogEntity) {
      return {
        totalSupplyDeuro: 0,
        totalValueLockedInEur: 0,
        depsMarketCapInEur: 0,
      };
    }

    const deuroLog = <DEuroLogDto>JSON.parse(maxDEuroLogEntity.message);

    const priceUsdToEur = await this.getPrice(this.usd, this.eur);

    return {
      totalSupplyDeuro: deuroLog.totalSupply,
      totalValueLockedInEur: priceUsdToEur.convert(deuroLog.totalValueLocked),
      depsMarketCapInEur: deuroLog.poolShares.marketCap,
    };
  }
}
