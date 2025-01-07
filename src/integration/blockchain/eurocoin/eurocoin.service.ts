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
import {
  EurocoinInfoDto,
  EurocoinLogDto,
  EurocoinPoolSharesDto,
  EurocoinPositionDto,
  EurocoinPositionGraphDto,
} from './dto/eurocoin.dto';
import { EurocoinClient } from './eurocoin-client';

@Injectable()
export class EurocoinService implements OnModuleInit {
  private readonly logger = new DfxLogger(EurocoinService);

  private static readonly LOG_SYSTEM = 'EvmInformation';
  private static readonly LOG_SUBSYSTEM = 'EurocoinSmartContract';

  private readonly client: EurocoinClient;

  private pricingService: PricingService;

  private usd: Fiat;
  private chf: Fiat;

  private readonly chainId: number;

  constructor(
    http: HttpService,
    private readonly moduleRef: ModuleRef,
    private readonly logService: LogService,
    private readonly fiatService: FiatService,
  ) {
    const { dEuroGatewayUrl, dEuroApiKey, dEuroChainId } = GetConfig().blockchain.eurocoin;

    this.client = new EurocoinClient(http, dEuroGatewayUrl, dEuroApiKey);
    this.chainId = dEuroChainId;
  }

  async onModuleInit() {
    this.pricingService = this.moduleRef.get(PricingService, { strict: false });

    this.usd = await this.fiatService.getFiatByName('USD');
    this.chf = await this.fiatService.getFiatByName('CHF');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock()
  async processLogInfo(): Promise<CreateLogDto> {
    if (DisabledProcess(Process.EUROCOIN_LOG_INFO)) return;

    const logMessage: EurocoinLogDto = {
      positionV2s: await this.getPositionV2s(),
      poolShares: await this.getDEPS(),
      totalSupply: await this.getTotalSupply(),
      totalValueLocked: await this.getTvl(),
    };

    const log: CreateLogDto = {
      system: EurocoinService.LOG_SYSTEM,
      subsystem: EurocoinService.LOG_SUBSYSTEM,
      severity: LogSeverity.INFO,
      message: JSON.stringify(logMessage),
      valid: null,
      category: null,
    };

    await this.logService.create(log);

    return log;
  }

  async getPositionV2s(): Promise<EurocoinPositionDto[]> {
    const positions = await this.client.getPositionV2s();
    return this.getPositions(positions);
  }

  private async getPositions(positions: EurocoinPositionGraphDto[]): Promise<EurocoinPositionDto[]> {
    const positionsResult: EurocoinPositionDto[] = [];

    for (const position of positions) {
      try {
        const eurocoinContract = this.client.getEurocoinContract(this.chainId);

        const calculateAssignedReserve = await eurocoinContract.calculateAssignedReserve(
          position.minted,
          position.reserveContribution,
        );

        positionsResult.push({
          address: {
            position: position.position,
            eurocoin: position.deuro,
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

  async getDEPS(): Promise<EurocoinPoolSharesDto> {
    const equityContract = this.client.getEquityContract(this.chainId);
    const eurocoinContract = this.client.getEurocoinContract(this.chainId);

    const deps = await this.client.getDEPS(this.chainId);

    try {
      const totalSupply = await equityContract.totalSupply();
      const price = await equityContract.price();
      const eurocoinMinterReserve = await eurocoinContract.minterReserve();
      const eurocoinEquity = await eurocoinContract.equity();

      const depsResult: EurocoinPoolSharesDto = {
        depsPrice: EvmUtil.fromWeiAmount(price),
        supply: EvmUtil.fromWeiAmount(totalSupply),
        marketCap: EvmUtil.fromWeiAmount(totalSupply) * EvmUtil.fromWeiAmount(price),
        totalReserve: EvmUtil.fromWeiAmount(eurocoinMinterReserve) + EvmUtil.fromWeiAmount(eurocoinEquity),
        equityCapital: EvmUtil.fromWeiAmount(eurocoinEquity),
        minterReserve: EvmUtil.fromWeiAmount(eurocoinMinterReserve),
        totalIncome: EvmUtil.fromWeiAmount(deps?.profits ?? '0x0'),
        totalLosses: EvmUtil.fromWeiAmount(deps?.loss ?? '0x0'),
      };

      return depsResult;
    } catch (e) {
      this.logger.error(`Error while getting pool shares ${deps?.id ?? 0}`, e);
    }
  }

  private async getTotalSupply(): Promise<number> {
    const eurocoinContract = this.client.getEurocoinContract(this.chainId);
    const deuroTotalSupply = await eurocoinContract.totalSupply();

    return EvmUtil.fromWeiAmount(deuroTotalSupply);
  }

  async getTvl(): Promise<number> {
    // TODO: Frankencoin TVL comes from "https://api.llama.fi/tvl/frankencoin"
    // TODO: and Eurocoin TVL comes from "?????"
    return 0; //this.client.getTvl();
  }

  async getEurocoinInfo(): Promise<EurocoinInfoDto> {
    const maxEurocoinLogEntity = await this.logService.maxEntity(
      EurocoinService.LOG_SYSTEM,
      EurocoinService.LOG_SUBSYSTEM,
      LogSeverity.INFO,
    );

    if (!maxEurocoinLogEntity) {
      return {
        totalSupplyZchf: 0,
        totalValueLockedInChf: 0,
        depsMarketCapInChf: 0,
      };
    }

    const eurocoinLog = <EurocoinLogDto>JSON.parse(maxEurocoinLogEntity.message);

    const priceUsdToChf = await this.pricingService.getPrice(this.usd, this.chf, true);

    return {
      totalSupplyZchf: eurocoinLog.totalSupply,
      totalValueLockedInChf: priceUsdToChf.convert(eurocoinLog.totalValueLocked),
      depsMarketCapInChf: eurocoinLog.poolShares.marketCap,
    };
  }
}
