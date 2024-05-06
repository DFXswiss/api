import { AddressType } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AlchemyWebhookService } from 'src/integration/alchemy/services/alchemy-webhook.service';
import { NodeClient } from 'src/integration/blockchain/ain/node/node-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Util } from 'src/shared/utils/util';
import { DepositRepository } from 'src/subdomains/supporting/address-pool/deposit/deposit.repository';
import { In } from 'typeorm';
import { Deposit } from './deposit.entity';
import { CreateDepositDto } from './dto/create-deposit.dto';

@Injectable()
export class DepositService {
  private btcInpClient: NodeClient;
  private readonly lightningClient: LightningClient;

  constructor(
    private readonly depositRepo: DepositRepository,
    private readonly alchemyWebhookService: AlchemyWebhookService,
    nodeService: NodeService,
    lightningService: LightningService,
  ) {
    this.lightningClient = lightningService.getDefaultClient();
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((c) => (this.btcInpClient = c));
  }

  async getDeposit(id: number): Promise<Deposit> {
    return this.depositRepo.findOneBy({ id });
  }

  async getDepositByAddress({ address, blockchain }: BlockchainAddress): Promise<Deposit> {
    return this.depositRepo.findOneBy({ address, blockchain });
  }

  async getAllDeposits(): Promise<Deposit[]> {
    return this.depositRepo.find();
  }

  async getDepositsByBlockchain(blockchain: Blockchain): Promise<Deposit[]> {
    return this.depositRepo.findBy({ blockchain: blockchain });
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
    if ([Blockchain.BITCOIN].includes(blockchain)) {
      return this.createBitcoinDeposits(blockchain, count);
    } else if (CryptoService.EthereumBasedChains.includes(blockchain)) {
      return this.createEvmDeposits(blockchain, count);
    } else if (blockchain === Blockchain.LIGHTNING) {
      return this.createLightningDeposits(blockchain, count);
    }

    throw new BadRequestException(`Deposit creation for ${blockchain} not possible.`);
  }

  private async createBitcoinDeposits(blockchain: Blockchain, count: number) {
    const client = this.btcInpClient;
    const label = Util.isoDate(new Date());
    const type = AddressType.P2SH_SEGWIT;

    for (let i = 0; i < count; i++) {
      const address = await client.createAddress(label, type);
      const deposit = Deposit.create(address, blockchain);
      await this.depositRepo.save(deposit);
    }
  }

  private async createEvmDeposits(blockchain: Blockchain, count: number) {
    const addresses: string[] = await this.getDepositsByBlockchain(blockchain).then((d) => d.map((d) => d.address));

    const nextDepositIndex = await this.getNextDepositIndex(CryptoService.EthereumBasedChains);

    for (let i = 0; i < count; i++) {
      const accountIndex = nextDepositIndex + i;

      const wallet = EvmUtil.createWallet(Config.blockchain.evm.walletAccount(accountIndex));
      const deposit = Deposit.create(wallet.address, blockchain, accountIndex);
      await this.depositRepo.save(deposit);

      addresses.push(deposit.address);
    }

    await this.alchemyWebhookService.createAddressWebhook({ blockchain: blockchain, addresses: addresses });
  }

  private async createLightningDeposits(blockchain: Blockchain, count: number) {
    const nextDepositIndex = await this.getNextDepositIndex([blockchain]);

    for (let i = 0; i < count; i++) {
      const accountIndex = nextDepositIndex + i;

      const { id } = await this.lightningClient.addLnurlpLink(`DFX Deposit Address ${accountIndex}`);
      const lnurlp = LightningHelper.createEncodedLnurlp(id);

      const deposit = Deposit.create(lnurlp, blockchain, accountIndex);
      await this.depositRepo.save(deposit);
    }
  }

  private async getNextDepositIndex(blockchains: Blockchain[]): Promise<number> {
    const lastDeposit = await this.depositRepo.findOne({
      where: { blockchain: In(blockchains) },
      order: { accountIndex: 'DESC' },
    });
    return (lastDeposit?.accountIndex ?? -1) + 1;
  }
}
