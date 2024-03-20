import verifyCardanoSignature from '@cardano-foundation/cardano-verify-datasignature';
import { MainNet } from '@defichain/jellyfish-network';
import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { isEthereumAddress } from 'class-validator';
import { verifyMessage } from 'ethers/lib/utils';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { NodeService } from '../../ain/node/node.service';
import { ArweaveService } from '../../arweave/services/arweave.service';
import { LiquidHelper } from '../../liquid/liquid-helper';
import { MoneroService } from '../../monero/services/monero.service';
import { EvmRegistryService } from '../evm/evm-registry.service';

@Injectable()
export class CryptoService {
  private readonly defaultEthereumChain = Blockchain.ARBITRUM;

  readonly EthereumBasedChains = [
    Blockchain.ETHEREUM,
    Blockchain.BINANCE_SMART_CHAIN,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.POLYGON,
    Blockchain.BASE,
    Blockchain.HAQQ,
  ];

  constructor(
    private readonly lightningService: LightningService,
    private readonly moneroService: MoneroService,
    private readonly arweaveService: ArweaveService,
    private readonly nodeService: NodeService,
    private readonly evmRegistryService: EvmRegistryService,
  ) {}

  // --- PAYMENT REQUEST --- //
  async getPaymentRequest(
    isValid: boolean,
    asset: Asset,
    address: string,
    amount: number,
  ): Promise<string | undefined> {
    if (!isValid) return undefined;

    switch (asset.blockchain) {
      case Blockchain.LIGHTNING:
        return this.lightningService.getInvoiceByLnurlp(address, amount);

      case Blockchain.BITCOIN:
        return this.nodeService.getBtcPaymentRequest(address, amount);

      case Blockchain.ETHEREUM:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.POLYGON:
      case Blockchain.BASE:
      case Blockchain.HAQQ:
      case Blockchain.BINANCE_SMART_CHAIN:
        const evmService = this.evmRegistryService.getService(asset.blockchain);
        return evmService.getPaymentRequest(address, asset, amount);

      default:
        return undefined;
    }
  }

  // --- ADDRESSES --- //
  public getBlockchainsBasedOn(address: string): Blockchain[] {
    if (isEthereumAddress(address)) return this.EthereumBasedChains;
    if (this.isBitcoinAddress(address)) return [Blockchain.BITCOIN];
    if (this.isLightningAddress(address)) return [Blockchain.LIGHTNING];
    if (this.isMoneroAddress(address)) return [Blockchain.MONERO];
    if (this.isLiquidAddress(address)) return [Blockchain.LIQUID];
    if (CryptoService.isArweaveAddress(address)) return [Blockchain.ARWEAVE];
    if (CryptoService.isCardanoAddress(address)) return [Blockchain.CARDANO];
    return [Blockchain.DEFICHAIN];
  }

  public getDefaultBlockchainBasedOn(address: string): Blockchain {
    const chains = this.getBlockchainsBasedOn(address);
    return chains.includes(this.defaultEthereumChain)
      ? this.defaultEthereumChain
      : this.getBlockchainsBasedOn(address)[0];
  }

  private isBitcoinAddress(address: string): boolean {
    return RegExp(`^(${Config.bitcoinAddressFormat})$`).test(address);
  }

  private isLightningAddress(address: string): boolean {
    return RegExp(`^(${Config.lightningAddressFormat})$`).test(address);
  }

  private isMoneroAddress(address: string): boolean {
    return RegExp(`^(${Config.moneroAddressFormat})$`).test(address);
  }

  private isLiquidAddress(address: string): boolean {
    return new RegExp(`^(${Config.liquidAddressFormat})$`).test(address);
  }

  public static isArweaveAddress(address: string): boolean {
    return new RegExp(`^(${Config.arweaveAddressFormat})$`).test(address);
  }

  public static isCardanoAddress(address: string): boolean {
    return new RegExp(`^(${Config.cardanoAddressFormat})$`).test(address);
  }

  // --- SIGNATURE VERIFICATION --- //
  public async verifySignature(message: string, address: string, signature: string, key?: string): Promise<boolean> {
    const blockchain = this.getDefaultBlockchainBasedOn(address);

    try {
      if (this.EthereumBasedChains.includes(blockchain)) return this.verifyEthereumBased(message, address, signature);
      if (blockchain === Blockchain.BITCOIN) return this.verifyBitcoinBased(message, address, signature, null);
      if (blockchain === Blockchain.LIGHTNING) return this.verifyLightning(message, signature, key);
      if (blockchain === Blockchain.MONERO) return await this.verifyMonero(message, address, signature);
      if (blockchain === Blockchain.LIQUID) return this.verifyLiquid(message, address, signature);
      if (blockchain === Blockchain.ARWEAVE) return this.verifyArweave(message, signature, key);
      if (blockchain === Blockchain.DEFICHAIN)
        return this.verifyBitcoinBased(message, address, signature, MainNet.messagePrefix);
      if (blockchain === Blockchain.CARDANO) return this.verifyCardano(message, address, signature, key);
    } catch {}

    return false;
  }

  private verifyEthereumBased(message: string, address: string, signature: string): boolean {
    // there are signatures out there, which do not have '0x' in the beginning, but for verification this is needed
    const signatureToUse = signature.startsWith('0x') ? signature : '0x' + signature;
    return verifyMessage(message, signatureToUse).toLowerCase() === address.toLowerCase();
  }

  private verifyBitcoinBased(message: string, address: string, signature: string, prefix: string | null): boolean {
    let isValid = false;
    try {
      isValid = verify(message, address, signature, prefix, true);
    } catch {}

    if (!isValid) isValid = verify(message, address, signature, prefix);

    return isValid;
  }

  private verifyLightning(message: string, signature: string, key: string): boolean {
    return this.lightningService.verifySignature(message, signature, key);
  }

  private async verifyMonero(message: string, address: string, signature: string): Promise<boolean> {
    return this.moneroService.verifySignature(message, address, signature);
  }

  private verifyLiquid(message: string, address: string, signature: string): boolean {
    return this.verifyBitcoinBased(message, LiquidHelper.getUnconfidentialAddress(address), signature, null);
  }

  private verifyCardano(message: string, address: string, signature: string, key?: string): boolean {
    return verifyCardanoSignature(signature, key, message, address);
  }

  private async verifyArweave(message: string, signature: string, key: string): Promise<boolean> {
    return this.arweaveService.verifySignature(message, signature, key);
  }
}
