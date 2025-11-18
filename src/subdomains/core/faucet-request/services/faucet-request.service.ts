import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { FaucetRequestDto } from '../dto/faucet-request.dto';
import { FaucetRequestStatus } from '../enums/faucet-request';
import { FaucetRequestRepository } from '../repositories/faucet-request.repository';

@Injectable()
export class FaucetRequestService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly faucetRequestRepo: FaucetRequestRepository,
    private readonly blockchainRegistry: BlockchainRegistryService,
    private readonly payoutService: PayoutService,
    private readonly assetService: AssetService,
    private readonly userService: UserService,
  ) {}

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.CRYPTO_PAYOUT })
  async checkFaucetRequests(): Promise<void> {
    const pendingFaucets = await this.faucetRequestRepo.find({ where: { status: FaucetRequestStatus.CREATED } });
    for (const faucet of pendingFaucets) {
      const client = this.blockchainRegistry.getEvmClient(Blockchain.ETHEREUM);
      if (await client.isTxComplete(faucet.txId)) await this.faucetRequestRepo.update(...faucet.complete());
    }
  }

  async createFaucet(userId: number): Promise<FaucetRequestDto> {
    const user = await this.userService.getUser(userId, { userData: true });
    if (!user) throw new NotFoundException('User not found');
    if (!user.blockchains.includes(Blockchain.ETHEREUM)) throw new NotFoundException('No Ethereum address found');

    if (!user.userData) throw new NotFoundException('Account not found');
    if (user.userData.kycLevel < KycLevel.LEVEL_30) throw new ForbiddenException('Account not verified');

    const faucetUsed = await this.faucetRequestRepo.exists({ where: { id: user.userData.id } });
    if (!faucetUsed) throw new BadRequestException('Faucet already exists for this account');

    const client = this.blockchainRegistry.getEvmClient(Blockchain.ETHEREUM);
    const asset = await this.assetService.getNativeAsset(Blockchain.ETHEREUM);
    const sendFee = await this.payoutService.estimateBlockchainFee(asset);
    const txId = await client.sendNativeCoinFromDex(user.address, sendFee.amount);

    const faucetRequest = this.faucetRequestRepo.create({ userData: user.userData, txId, amount: sendFee.amount });
    await this.faucetRequestRepo.save(faucetRequest);

    return { txId, amount: sendFee.amount };
  }
}
