import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CronExpression } from '@nestjs/schedule';
import { Contract, ethers } from 'ethers';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CreateLogDto } from 'src/subdomains/supporting/log/dto/create-log.dto';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { PriceCurrency, PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FrankencoinService } from '../frankencoin/frankencoin.service';
import { CollateralWithTotalBalance } from '../shared/dto/frankencoin-based.dto';
import { EvmUtil } from '../shared/evm/evm.util';
import { FrankencoinBasedService } from '../shared/frankencoin/frankencoin-based.service';
import { BlockchainRegistryService } from '../shared/services/blockchain-registry.service';
import { DEuroClient } from './deuro-client';
import {
  DEuroBridgeLogDto,
  DEuroInfoDto,
  DEuroLogDto,
  DEuroPoolSharesDto,
  DEuroPositionDto,
  DEuroPositionGraphDto,
  DEuroSavingsInfoDto,
  DEuroSavingsLogDto,
} from './dto/deuro.dto';

@Injectable()
export class DEuroService extends FrankencoinBasedService implements OnModuleInit {
  private static readonly LOG_SYSTEM = 'EvmInformation';
  private static readonly LOG_SUBSYSTEM = 'DEuroSmartContract';

  private deuroClient: DEuroClient;

  private frankencoinService: FrankencoinService;

  constructor(private readonly moduleRef: ModuleRef, private readonly logService: LogService) {
    super();
  }

  onModuleInit() {
    this.setup(
      this.moduleRef.get(PricingService, { strict: false }),
      this.moduleRef.get(BlockchainRegistryService, { strict: false }),
    );

    this.frankencoinService = this.moduleRef.get(FrankencoinService, { strict: false });

    this.deuroClient = new DEuroClient(this.getEvmClient());
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.DEURO_LOG_INFO })
  async processLogInfo(): Promise<void> {
    const collateralTvl = await this.getCollateralTvl();
    const bridgeTvl = await this.getBridgeTvl();
    const totalValueLocked = collateralTvl + bridgeTvl;

    const positionV2s = await this.getPositionV2s();
    const totalBorrowed = Util.sum(positionV2s.map((p) => p.details.totalBorrowed));

    const logMessage: DEuroLogDto = {
      positionV2s,
      poolShares: await this.getDEPS(),
      savings: await this.getSavingsLogInfo(),
      bridges: await this.getBridgeLogInfo(),
      totalSupply: await this.getTotalSupply(),
      totalValueLocked,
      totalBorrowed,
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
    const positions = await this.deuroClient.getPositionV2s();
    return this.getPositions(positions);
  }

  private async getPositions(positions: DEuroPositionGraphDto[]): Promise<DEuroPositionDto[]> {
    const positionsResult: DEuroPositionDto[] = [];

    for (const position of positions) {
      try {
        const deuroContract = this.deuroClient.getDEuroContract();
        const calculateAssignedReserve = await deuroContract.calculateAssignedReserve(
          position.principal,
          position.reserveContribution,
        );

        const positionContract = this.deuroClient.getPositionContract(position.id);
        const virtualPrice = await positionContract.virtualPrice();

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

  async getDEPS(): Promise<DEuroPoolSharesDto> {
    const equityContract = this.getEquityContract();

    const deuroContract = this.deuroClient.getDEuroContract();

    const deps = await this.deuroClient.getDEPS();

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
    const deuroContract = this.deuroClient.getDEuroContract();
    const deuroTotalSupply = await deuroContract.totalSupply();

    return EvmUtil.fromWeiAmount(deuroTotalSupply);
  }

  getWalletAddress(): string {
    return this.deuroClient.getWalletAddress();
  }

  getEquityContract(): Contract {
    return this.deuroClient.getEquityContract();
  }

  async getEquityPrice(): Promise<number> {
    return this.getDEPSPrice();
  }

  getWrapperContract(): Contract {
    return this.deuroClient.getDEPSWrapperContract();
  }

  async getDEPSPrice(): Promise<number> {
    const equityContract = this.getEquityContract();
    const price = await equityContract.price();

    return EvmUtil.fromWeiAmount(price);
  }

  async getCollateralTvl(): Promise<number> {
    const positionV2s = await this.deuroClient.getPositionV2s();

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
    const bridgeContracts = this.deuroClient.getBridgeContracts();

    let tvl = 0;

    for (const bridgeContract of bridgeContracts) {
      const eurTokenAddress = await bridgeContract.eur();

      const eurTokenContract = this.deuroClient.getErc20Contract(eurTokenAddress);
      const eurTokenPrice =
        (await this.getCoinGeckoPrice(eurTokenContract.address)) ?? (await this.getBridgePriceFallback());

      const minted = await bridgeContract.minted();
      const mintedValue = EvmUtil.fromWeiAmount(minted);

      tvl += mintedValue / eurTokenPrice;
    }

    return tvl;
  }

  private async getBridgePriceFallback(): Promise<number> {
    const eurcContract = this.deuroClient.getBridgeEURCContract();
    const eurcTokenAddress = await eurcContract.eur();
    const eurcTokenContract = this.deuroClient.getErc20Contract(eurcTokenAddress);

    return this.getCoinGeckoPrice(eurcTokenContract.address) ?? 0;
  }

  async getSavingsLogInfo(): Promise<DEuroSavingsLogDto> {
    return this.deuroClient.getSavingsInfo().then((s) => this.mapSavingsInfo(s));
  }

  private mapSavingsInfo(savingsInfo: DEuroSavingsInfoDto): DEuroSavingsLogDto {
    return {
      totalSaved: savingsInfo.totalSaved,
      totalBalance: savingsInfo.totalBalance,
    };
  }

  async getBridgeLogInfo(): Promise<DEuroBridgeLogDto[]> {
    const bridgeLogInfo: DEuroBridgeLogDto[] = [];

    const bridgeContracts = this.deuroClient.getBridgeContracts();

    for (const bridgeContract of bridgeContracts) {
      const minted = await bridgeContract.minted();
      const eurTokenAddress = await bridgeContract.eur();

      const eurTokenContract = this.deuroClient.getErc20Contract(eurTokenAddress);
      const symbol = await eurTokenContract.symbol();

      bridgeLogInfo.push({ symbol, minted: EvmUtil.fromWeiAmount(minted) });
    }

    return bridgeLogInfo;
  }

  async getCustomCollateralPrice(collateral: CollateralWithTotalBalance): Promise<number | undefined> {
    if (collateral.symbol === 'WFPS') {
      const fpsPriceInChf = await this.frankencoinService.getFPSPrice();
      const priceChfToUsd = await this.getPrice(PriceCurrency.CHF, PriceCurrency.USD);

      return 1 / priceChfToUsd.convert(fpsPriceInChf);
    } else if (collateral.symbol === 'DEPS') {
      return this.getCoinGeckoPrice(this.deuroClient.getEquityContract().address);
    }
  }

  async bridgeEurcToDeuro(amount: ethers.BigNumber): Promise<string> {
    return this.deuroClient.bridgeEurcToDeuro(amount);
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

    const priceUsdToEur = await this.getPrice(PriceCurrency.USD, PriceCurrency.EUR);

    return {
      totalSupplyDeuro: deuroLog.totalSupply,
      totalValueLockedInEur: priceUsdToEur.convert(deuroLog.totalValueLocked),
      depsMarketCapInEur: deuroLog.poolShares.marketCap,
    };
  }
}
