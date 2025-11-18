import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { Not } from 'typeorm';
import { FaucetRequestDto } from '../dto/faucet-request.dto';
import { FaucetRequestStatus } from '../enums/faucet-request';
import { FaucetRequestRepository } from '../repositories/faucet-request.repository';

@Injectable()
export class FaucetRequestService {
  constructor(
    private readonly faucetRequestRepo: FaucetRequestRepository,
    private readonly blockchainRegistry: BlockchainRegistryService,
    private readonly payoutService: PayoutService,
    private readonly assetService: AssetService,
    private readonly userService: UserService,
  ) {}
  private readonly logger = new DfxLogger(FaucetRequestService);

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.CRYPTO_PAYOUT })
  async checkFaucetRequests(): Promise<void> {
    const pendingFaucets = await this.faucetRequestRepo.find({ where: { status: FaucetRequestStatus.IN_PROGRESS } });
    for (const faucet of pendingFaucets) {
      const client = this.blockchainRegistry.getEvmClient(faucet.asset.blockchain);
      try {
        if (await client.isTxComplete(faucet.txId)) await this.faucetRequestRepo.update(...faucet.complete());
      } catch (e) {
        await this.faucetRequestRepo.update(...faucet.failed());
        this.logger.error(`Faucet request ${faucet.id} failed:`, e);
      }
    }
  }

  async createFaucet(userId: number): Promise<FaucetRequestDto> {
    try {
      const user = await this.userService.getUser(userId, { userData: true });
      if (!user) throw new NotFoundException('User not found');
      if (!user.blockchains.includes(Blockchain.ETHEREUM))
        throw new BadRequestException('Faucet not available for this user');

      if (user.userData.kycLevel < KycLevel.LEVEL_30) throw new ForbiddenException('Account not verified');

      const faucetUsed = await this.faucetRequestRepo.exists({
        where: { userData: { id: user.userData.id }, status: Not(FaucetRequestStatus.FAILED) },
      });
      if (!faucetUsed) throw new BadRequestException('Faucet already used for this account');

      const client = this.blockchainRegistry.getEvmClient(Blockchain.ETHEREUM);
      const asset = await this.assetService.getNativeAsset(Blockchain.ETHEREUM);
      const sendFee = await this.payoutService.estimateBlockchainFee(asset);
      const txId = await client.sendNativeCoinFromDex(user.address, sendFee.amount);

      const faucetRequest = this.faucetRequestRepo.create({ userData: user.userData, txId, amount: sendFee.amount });
      await this.faucetRequestRepo.save(faucetRequest);

      return { txId, amount: sendFee.amount };
    } catch (e) {
      this.logger.error(`Faucet request from user ${userId} failed:`, e);
      throw new ServiceUnavailableException('Faucet currently not available');
    }
  }
}
