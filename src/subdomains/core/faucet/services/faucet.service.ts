import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { FaucetDto, GetFaucetDto } from '../dto/faucet.dto';
import { FaucetRepository } from '../repositories/faucet.repository';

@Injectable()
export class FaucetService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly faucetRepo: FaucetRepository,
    private readonly blockchainRegistry: BlockchainRegistryService,
    private readonly payoutService: PayoutService,
    private readonly assetService: AssetService,
  ) {}

  async createFaucet(accountId: number, address: string, dto: GetFaucetDto): Promise<FaucetDto> {
    const userData = await this.userDataService.getUserData(accountId);
    if (!userData) throw new NotFoundException('Account not found');
    if (userData.kycLevel < KycLevel.LEVEL_30) throw new ForbiddenException('Account not verified');

    const faucets = await this.faucetRepo.find({ where: { id: userData.id } });
    if (faucets.length > 0) throw new BadRequestException('Faucet already exists for this account');

    const asset = dto.asset.id
      ? await this.assetService.getAssetById(dto.asset.id)
      : await this.assetService.getAssetByChainId(dto.asset.blockchain, dto.asset.chainId);

    const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
    const sendFee = await this.payoutService.estimateBlockchainFee(asset);
    const txId = await client.sendNativeCoinFromDex(address, sendFee.amount);

    const faucet = this.faucetRepo.create({ userData, txId, amount: sendFee.amount });
    await this.faucetRepo.save(faucet);

    return { txId, amount: sendFee.amount };
  }
}
