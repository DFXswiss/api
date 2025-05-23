import { AddressType } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { AlchemyWebhookService } from 'src/integration/alchemy/services/alchemy-webhook.service';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinService, BitcoinType } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
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
  private readonly bitcoinClient: BitcoinClient;
  private readonly lightningClient: LightningClient;
  private readonly moneroClient: MoneroClient;

  constructor(
    private readonly depositRepo: DepositRepository,
    private readonly alchemyWebhookService: AlchemyWebhookService,
    bitcoinService: BitcoinService,
    lightningService: LightningService,
    moneroService: MoneroService,
  ) {
    this.bitcoinClient = bitcoinService.getDefaultClient(BitcoinType.BTC_INPUT);
    this.lightningClient = lightningService.getDefaultClient();
    this.moneroClient = moneroService.getDefaultClient();
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
    } else if (blockchain === Blockchain.MONERO) {
      return this.createMoneroDeposits(blockchain, count);
    }

    throw new BadRequestException(`Deposit creation for ${blockchain} not possible.`);
  }

  private async createBitcoinDeposits(blockchain: Blockchain, count: number): Promise<void> {
    const client = this.bitcoinClient;
    const label = Util.isoDate(new Date());
    const type = AddressType.P2SH_SEGWIT;

    for (let i = 0; i < count; i++) {
      const address = await client.createAddress(label, type);
      const deposit = Deposit.create(address, [blockchain]);
      await this.depositRepo.save(deposit);
    }
  }

  private async createEvmDeposits(blockchain: Blockchain, count: number): Promise<void> {
    const addresses: string[] = await this.getDepositsByBlockchain(blockchain).then((d) => d.map((d) => d.address));

    const nextDepositIndex = await this.getNextDepositIndex(CryptoService.EthereumBasedChains);

    const applicableChains = AlchemyNetworkMapper.availableNetworks.includes(blockchain)
      ? AlchemyNetworkMapper.availableNetworks
      : [blockchain];

    for (let i = 0; i < count; i++) {
      const accountIndex = nextDepositIndex + i;

      const wallet = EvmUtil.createWallet(Config.blockchain.evm.walletAccount(accountIndex));
      const deposit = Deposit.create(wallet.address, applicableChains, accountIndex);
      await this.depositRepo.save(deposit);

      addresses.push(deposit.address);
    }

    addresses.push(this.createPaymentAddress(0));

    for (const chain of applicableChains) {
      await this.alchemyWebhookService.createAddressWebhook({ blockchain: chain, addresses: addresses });
    }
  }

  private createPaymentAddress(accountIndex: number): string {
    return EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: accountIndex }).address;
  }

  private async createLightningDeposits(blockchain: Blockchain, count: number): Promise<void> {
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
      const uniqueIdSignature = Util.createSign(uniqueId, Config.blockchain.lightning.lnbits.signingPrivKey);

      const lnurlpLinkUpdate: LnurlpLinkUpdateDto = {
        description: depositLink.description,
        min: depositLink.min,
        max: depositLink.max,
        currency: depositLink.currency,
        comment_chars: depositLink.comment_chars,
        webhook_url: `${Config.url()}/payIn/lnurlpDeposit/${uniqueId}`,
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

  private async createMoneroDeposits(blockchain: Blockchain, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const moneroAddress = await this.moneroClient.createAddress();

      const deposit = Deposit.create(moneroAddress.address, [blockchain], moneroAddress.address_index);
      await this.depositRepo.save(deposit);
    }
  }
}
