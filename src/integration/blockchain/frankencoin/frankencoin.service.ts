import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BigNumberish, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { CreateLogDto } from 'src/subdomains/supporting/log/dto/create-log.dto';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import {
  FrankencoinChallengeDto,
  FrankencoinDelegationDto,
  FrankencoinFpsDto,
  FrankencoinLogInfoDto,
  FrankencoinMinterDto,
  FrankencoinTradeDto,
} from './dto/frankencoin.dto';
import { FrankencoinClient } from './frankencoin-client';

@Injectable()
export class FrankencoinService {
  private readonly logger = new DfxLogger(FrankencoinService);

  private readonly client: FrankencoinClient;

  constructor(private readonly logService: LogService) {
    const { zchfGatewayUrl, zchfApiKey } = GetConfig().blockchain.frankencoin;

    this.client = new FrankencoinClient(zchfGatewayUrl, zchfApiKey);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock()
  async processLogInfo() {
    if (DisabledProcess(Process.FRANKENCOIN_LOG_INFO)) return;

    const positions = await this.getPositions();

    const log: CreateLogDto = {
      system: 'EvmInformation',
      subsystem: 'FrankencoinSmartContract',
      severity: LogSeverity.INFO,
      message: JSON.stringify(positions),
    };

    await this.logService.create(log);
  }

  async getPositions(): Promise<FrankencoinLogInfoDto[]> {
    const logInfo: FrankencoinLogInfoDto[] = [];

    const positions = await this.client.getPositions();

    for (const position of positions) {
      try {
        const collateralContract = this.client.getCollateralContract(position.collateral);

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

        logInfo.push({
          address: {
            position: position.position,
            frankencoin: position.zchf,
            collateral: position.collateral,
            owner: position.owner,
          },
          collateral: {
            symbol: symbol,
            amount: this.fromWeiAmount(positionBalance, decimals),
          },
          details: {
            availableAmount: this.fromWeiAmount(limitForClones),
            totalBorrowed: this.fromWeiAmount(minted),
            liquidationPrice: this.fromWeiAmount(price, 36 - decimals),
            retainedReserve: this.fromWeiAmount(calculateAssignedReserve),
            limit: this.fromWeiAmount(limit),
            expirationDate: new Date(Number(expiration) * 1000),
          },
        });
      } catch (e) {
        this.logger.error(`Error while getting position ${position.position}`, e);
      }
    }

    return logInfo;
  }

  async getChallenges(): Promise<FrankencoinChallengeDto[]> {
    return this.client.getChallenges();
  }

  async getFPS(): Promise<FrankencoinFpsDto[]> {
    return this.client.getFPS();
  }

  async getMinters(): Promise<FrankencoinMinterDto[]> {
    return this.client.getMinters();
  }

  async getDelegations(): Promise<FrankencoinDelegationDto[]> {
    return this.client.getDelegations();
  }

  async getTrades(): Promise<FrankencoinTradeDto[]> {
    return this.client.getTrades();
  }

  // --- HELPER METHOD --- //

  private fromWeiAmount(amountWeiLike: BigNumberish, decimals?: number): number {
    const amount =
      decimals != null ? ethers.utils.formatUnits(amountWeiLike, decimals) : ethers.utils.formatEther(amountWeiLike);

    return parseFloat(amount);
  }
}
