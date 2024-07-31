import { AddressType } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { AlchemyWebhookService } from 'src/integration/alchemy/services/alchemy-webhook.service';
import { NodeClient } from 'src/integration/blockchain/ain/node/node-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { LnurlpLinkUpdateDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Util } from 'src/shared/utils/util';
import { DepositRepository } from 'src/subdomains/supporting/address-pool/deposit/deposit.repository';
import { Like } from 'typeorm';
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
    return this.depositRepo.findOneBy({ address, blockchains: Like(`%${blockchain}%`) });
  }

  async getAllDeposits(): Promise<Deposit[]> {
    return this.depositRepo.find();
  }

  async getDepositsByBlockchain(blockchain: Blockchain): Promise<Deposit[]> {
    return this.depositRepo.findBy({ blockchains: Like(`%${blockchain}%`) });
  }

  async getNextDeposit(blockchain: Blockchain): Promise<Deposit> {
    // does not work with find options
    const deposit = await this.depositRepo
      .createQueryBuilder('deposit')
      .leftJoin('deposit.route', 'route')
      .where('route.id IS NULL AND deposit.blockchains LIKE :blockchain', { blockchain: `%${blockchain}%` })
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
      const deposit = Deposit.create(address, [blockchain]);
      await this.depositRepo.save(deposit);
    }
  }

  private async createEvmDeposits(blockchain: Blockchain, count: number) {
    const addresses: string[] = await this.getDepositsByBlockchain(blockchain).then((d) => d.map((d) => d.address));

    const nextDepositIndex = await this.getNextDepositIndex(CryptoService.EthereumBasedChains);

    const applicableChains = AlchemyNetworkMapper.availableNetworks.includes(blockchain)
      ? AlchemyNetworkMapper.availableNetworks
      : [blockchain];

    for (let i = 0; i < count; i++) {
      const accountIndex = nextDepositIndex + i;

      addresses.push(
        await this.saveEvmDeposit(Config.blockchain.evm.walletAccount(accountIndex), applicableChains, accountIndex),
      );
    }

    addresses.push(await this.saveEvmDeposit(Config.payment.walletAccount(0), applicableChains, 0));

    for (const chain of applicableChains) {
      await this.alchemyWebhookService.createAddressWebhook({ blockchain: chain, addresses: addresses });
    }
  }

  private async saveEvmDeposit(
    walletAccount: WalletAccount,
    applicableChains: Blockchain[],
    accountIndex: number,
  ): Promise<string> {
    const wallet = EvmUtil.createWallet(walletAccount);

    const deposit = await this.depositRepo.findOneBy({ address: wallet.address });

    if (!deposit) {
      await this.depositRepo.save(Deposit.create(wallet.address, applicableChains, accountIndex));
    }

    return wallet.address;
  }

  private async createLightningDeposits(blockchain: Blockchain, count: number) {
    const nextDepositIndex = await this.getNextDepositIndex([blockchain]);

    for (let i = 0; i < count; i++) {
      const accountIndex = nextDepositIndex + i;

      const { id } = await this.lightningClient.addLnurlpLink(`DFX Deposit Address ${accountIndex}`);
      const lnurlp = LightningHelper.createEncodedLnurlp(id);

      const deposit = Deposit.create(lnurlp, [blockchain], accountIndex);
      await this.depositRepo.save(deposit);
    }
  }

  private async getNextDepositIndex(blockchains: Blockchain[]): Promise<number> {
    const query = this.depositRepo.createQueryBuilder('deposit').select('MAX(deposit.accountIndex)', 'accountIndex');

    for (const blockchain of blockchains) {
      query.orWhere(`deposit.blockchains LIKE '%${blockchain}%'`);
    }

    return query.getRawOne<{ accountIndex: number }>().then((r) => (r?.accountIndex ?? -1) + 1);
  }

  async updateLightningDepositWebhook(): Promise<void> {
    const lnurlpLinks = await this.lightningClient.getLnurlpLinks();
    const depositLinks = lnurlpLinks.filter((l) => l.description.startsWith('DFX Deposit Address '));

    for (const depositLink of depositLinks) {
      const linkId = depositLink.id;

      const uniqueId = Util.createUniqueId('deposit');
      const uniqueIdSignature = Util.createSign(uniqueId, Config.dfx.signingPrivKey);

      const lnurlpLinkUpdate: LnurlpLinkUpdateDto = {
        description: depositLink.description,
        min: depositLink.min,
        max: depositLink.max,
        currency: depositLink.currency,
        comment_chars: depositLink.comment_chars,
        webhook_url: `${Config.url()}/paymentWebhook/lnurlpDeposit/${uniqueId}`,
        webhook_headers: `{ "Deposit-Signature": "${uniqueIdSignature}" }`,
        webhook_body: depositLink.webhook_body,
        success_text: depositLink.success_text,
        success_url: depositLink.success_url,
        fiat_base_multiplier: depositLink.fiat_base_multiplier,
        username: depositLink.username,
        zaps: depositLink.zaps,
      };

      await this.lightningClient.updateLnurlpLink(linkId, lnurlpLinkUpdate);
    }
  }
}
