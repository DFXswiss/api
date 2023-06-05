import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DepositRepository } from 'src/subdomains/supporting/address-pool/deposit/deposit.repository';
import { Deposit } from './deposit.entity';
import { CreateDepositDto } from './dto/create-deposit.dto';

@Injectable()
export class DepositService {
  private readonly lightningClient: LightningClient;

  constructor(private depositRepo: DepositRepository, lightningService: LightningService) {
    this.lightningClient = lightningService.getDefaultClient();
  }

  async getDeposit(id: number): Promise<Deposit> {
    return this.depositRepo.findOneBy({ id });
  }

  async getDepositByAddress({ address, blockchain }: BlockchainAddress): Promise<Deposit> {
    return this.depositRepo.findOneBy({ address, blockchain });
  }

  async getAllDeposit(): Promise<Deposit[]> {
    return this.depositRepo.find();
  }

  async getNextDeposit(blockchain: Blockchain): Promise<Deposit> {
    // does not work with find options
    const deposit = await this.depositRepo
      .createQueryBuilder('deposit')
      .leftJoin('deposit.route', 'route')
      .where('route.id IS NULL AND deposit.blockchain = :blockchain', { blockchain })
      .getOne();
    if (!deposit) throw new InternalServerErrorException(`No unused deposit for ${blockchain} found`);

    return deposit;
  }

  async createDeposits({ blockchain, count }: CreateDepositDto): Promise<void> {
    switch (blockchain) {
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.ETHEREUM:
      case Blockchain.BINANCE_SMART_CHAIN:
        return this.createEvmDeposits(blockchain, count);

      case Blockchain.LIGHTNING:
        return this.createLightningDeposits(blockchain, count);

      default:
        throw new BadRequestException(`Deposit creation for ${blockchain} not possible.`);
    }
  }

  private async createEvmDeposits(blockchain: Blockchain, count: number) {
    const nextDepositIndex = await this.getNextDepositIndex(blockchain);

    for (let i = 0; i < count; i++) {
      const accountIndex = nextDepositIndex + i;

      const wallet = EvmUtil.createWallet(Config.blockchain.evm.walletAccount(accountIndex));
      const deposit = Deposit.create(wallet.address, blockchain, accountIndex);
      await this.depositRepo.save(deposit);
    }
  }

  private async createLightningDeposits(blockchain: Blockchain, count: number) {
    const nextDepositIndex = await this.getNextDepositIndex(blockchain);

    for (let i = 0; i < count; i++) {
      const accountIndex = nextDepositIndex + i;

      const { id } = await this.lightningClient.addLnurlpLink(`DFX Deposit Address ${accountIndex}`);
      const lnurlp = LightningHelper.createEncodedLnurlp(id);

      const deposit = Deposit.create(lnurlp, blockchain, accountIndex);
      await this.depositRepo.save(deposit);
    }
  }

  private async getNextDepositIndex(blockchain: Blockchain): Promise<number> {
    const lastDeposit = await this.depositRepo.findOne({ where: { blockchain }, order: { accountIndex: 'DESC' } });
    return (lastDeposit?.accountIndex ?? -1) + 1;
  }
}
