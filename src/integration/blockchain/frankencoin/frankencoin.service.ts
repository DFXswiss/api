import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { CreateLogDto } from 'src/subdomains/supporting/log/dto/create-log.dto';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { EvmUtil } from '../shared/evm/evm.util';
import {
  FrankencoinChallengeGraphDto,
  FrankencoinDelegationGraphDto,
  FrankencoinLogDto,
  FrankencoinMinterGraphDto,
  FrankencoinPoolSharesDto,
  FrankencoinPositionDto,
  FrankencoinSwapDto,
  FrankencoinTradeGraphDto,
} from './dto/frankencoin.dto';
import { FrankencoinClient } from './frankencoin-client';

@Injectable()
export class FrankencoinService {
  private readonly logger = new DfxLogger(FrankencoinService);

  private static readonly LOG_SYSTEM = 'EvmInformation';

  private readonly client: FrankencoinClient;

  constructor(private readonly logService: LogService) {
    const { zchfGatewayUrl, zchfApiKey } = GetConfig().blockchain.frankencoin;

    this.client = new FrankencoinClient(zchfGatewayUrl, zchfApiKey);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock()
  async processLogInfo() {
    if (DisabledProcess(Process.FRANKENCOIN_LOG_INFO)) return;

    const logMessage: FrankencoinLogDto = {
      swap: await this.getSwap(),
      positions: await this.getPositions(),
      poolShares: await this.getFPSs(),
    };

    const log: CreateLogDto = {
      system: FrankencoinService.LOG_SYSTEM,
      subsystem: 'FrankencoinSmartContract',
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

  async getFPSs(): Promise<FrankencoinPoolSharesDto[]> {
    const fpssResult: FrankencoinPoolSharesDto[] = [];

    const equityContract = this.client.getEquityContract(Config.blockchain.frankencoin.contractAddress.equity);
    const frankencoinContract = this.client.getFrankencoinContract(Config.blockchain.frankencoin.contractAddress.zchf);

    const fpss = await this.client.getFPS();

    for (const fps of fpss) {
      try {
        const totalSupply = await equityContract.totalSupply();
        const price = await equityContract.price();
        const frankenMinterReserve = await frankencoinContract.minterReserve();
        const frankenEquity = await frankencoinContract.equity();

        fpssResult.push({
          fpsPrice: EvmUtil.fromWeiAmount(price),
          supply: EvmUtil.fromWeiAmount(totalSupply),
          marketCap: EvmUtil.fromWeiAmount(totalSupply) * EvmUtil.fromWeiAmount(price),
          totalReserve: EvmUtil.fromWeiAmount(frankenMinterReserve) + EvmUtil.fromWeiAmount(frankenEquity),
          equityCapital: EvmUtil.fromWeiAmount(frankenEquity),
          minterReserve: EvmUtil.fromWeiAmount(frankenMinterReserve),
          totalIncome: EvmUtil.fromWeiAmount(fps.profits),
          totalLosses: EvmUtil.fromWeiAmount(fps.loss),
        });
      } catch (e) {
        this.logger.error(`Error while getting pool shares ${fps.id}`, e);
      }
    }

    return fpssResult;
  }

  async getFPSPrice(): Promise<number> {
    const equityContract = this.client.getEquityContract(Config.blockchain.frankencoin.contractAddress.equity);
    const price = await equityContract.price();

    return EvmUtil.fromWeiAmount(price);
  }

  async getMinters(): Promise<FrankencoinMinterGraphDto[]> {
    return this.client.getMinters();
  }

  async getDelegations(): Promise<FrankencoinDelegationGraphDto[]> {
    return this.client.getDelegations();
  }

  async getTrades(): Promise<FrankencoinTradeGraphDto[]> {
    return this.client.getTrades();
  }
}
