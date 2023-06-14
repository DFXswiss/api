import { AddressType } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Config } from 'src/config/config';
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
  private inpClient: NodeClient;
  private btcInpClient: NodeClient;
  private readonly lightningClient: LightningClient;

  constructor(
    private readonly depositRepo: DepositRepository,
    private readonly cryptoService: CryptoService,
    nodeService: NodeService,
    lightningService: LightningService,
  ) {
    this.lightningClient = lightningService.getDefaultClient();
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((c) => (this.inpClient = c));
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((c) => (this.btcInpClient = c));
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
    if ([Blockchain.DEFICHAIN, Blockchain.BITCOIN].includes(blockchain)) {
      return this.createJellyfishDeposits(blockchain, count);
    } else if (this.cryptoService.EthereumBasedChains.includes(blockchain)) {
      return this.createEvmDeposits(blockchain, count);
    } else if (blockchain === Blockchain.LIGHTNING) {
      return this.createLightningDeposits(blockchain, count);
    }

    throw new BadRequestException(`Deposit creation for ${blockchain} not possible.`);
  }

  private async createJellyfishDeposits(blockchain: Blockchain, count: number) {
    const client = blockchain === Blockchain.DEFICHAIN ? this.inpClient : this.btcInpClient;
    const label = Util.isoDate(new Date());
    const type = blockchain === Blockchain.DEFICHAIN ? AddressType.BECH32 : AddressType.P2SH_SEGWIT;

    for (let i = 0; i < count; i++) {
      const address = await client.createAddress(label, type);
      const deposit = Deposit.create(address, blockchain);
      await this.depositRepo.save(deposit);
    }
  }

  private async createEvmDeposits(blockchain: Blockchain, count: number) {
    const nextDepositIndex = await this.getNextDepositIndex(this.cryptoService.EthereumBasedChains);

    for (let i = 0; i < count; i++) {
      const accountIndex = nextDepositIndex + i;

      const wallet = EvmUtil.createWallet(Config.blockchain.evm.walletAccount(accountIndex));
      const deposit = Deposit.create(wallet.address, blockchain, accountIndex);
      await this.depositRepo.save(deposit);
    }
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
