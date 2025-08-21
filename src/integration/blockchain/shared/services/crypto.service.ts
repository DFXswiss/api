import verifyCardanoSignature from '@cardano-foundation/cardano-verify-datasignature';
import { MainNet } from '@defichain/jellyfish-network';
import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { isEthereumAddress } from 'class-validator';
import { verifyMessage } from 'ethers/lib/utils';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { RailgunService } from 'src/integration/railgun/railgun.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { UserAddressType } from 'src/subdomains/generic/user/models/user/user.entity';
import { ArweaveService } from '../../arweave/services/arweave.service';
import { BitcoinService } from '../../bitcoin/node/bitcoin.service';
import { LiquidHelper } from '../../liquid/liquid-helper';
import { MoneroService } from '../../monero/services/monero.service';
import { SolanaService } from '../../solana/services/solana.service';
import { TronService } from '../../tron/services/tron.service';
import { ZanoService } from '../../zano/services/zano.service';
import { EvmUtil } from '../evm/evm.util';

@Injectable()
export class CryptoService {
  private static readonly defaultEthereumChain = Blockchain.ETHEREUM;

  static readonly EthereumBasedChains = [
    Blockchain.ETHEREUM,
    Blockchain.SEPOLIA,
    Blockchain.BINANCE_SMART_CHAIN,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.POLYGON,
    Blockchain.BASE,
    Blockchain.GNOSIS,
    Blockchain.HAQQ,
    Blockchain.CITREA_TESTNET,
  ];

  constructor(
    private readonly bitcoinService: BitcoinService,
    private readonly lightningService: LightningService,
    private readonly moneroService: MoneroService,
    private readonly zanoService: ZanoService,
    private readonly solanaService: SolanaService,
    private readonly tronService: TronService,
    private readonly arweaveService: ArweaveService,
    private readonly railgunService: RailgunService,
  ) {}

  // --- PAYMENT REQUEST --- //
  async getPaymentRequest(
    isValid: boolean,
    asset: Asset,
    address: string,
    amount: number,
    label?: string,
  ): Promise<string | undefined> {
    if (!isValid) return undefined;

    switch (asset.blockchain) {
      case Blockchain.BITCOIN:
        return this.bitcoinService.getPaymentRequest(address, amount, label);

      case Blockchain.LIGHTNING:
        return this.lightningService.getInvoiceByLnurlp(address, amount);

      case Blockchain.MONERO:
        return this.moneroService.getPaymentRequest(address, amount);

      case Blockchain.ZANO:
        return this.zanoService.getPaymentRequest(address, amount);

      case Blockchain.ETHEREUM:
      case Blockchain.SEPOLIA:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.POLYGON:
      case Blockchain.BASE:
      case Blockchain.GNOSIS:
      case Blockchain.HAQQ:
      case Blockchain.BINANCE_SMART_CHAIN:
      case Blockchain.CITREA_TESTNET:
        return EvmUtil.getPaymentRequest(address, asset, amount);

      case Blockchain.SOLANA:
        return this.solanaService.getPaymentRequest(address, amount);

      case Blockchain.TRON:
        return this.tronService.getPaymentRequest(address, amount);

      default:
        return undefined;
    }
  }

  // --- ADDRESSES --- //
  public static getAddressType(address: string): UserAddressType {
    const blockchain = CryptoService.getDefaultBlockchainBasedOn(address);

    switch (blockchain) {
      case Blockchain.BITCOIN:
        if (address.startsWith('bc1')) return UserAddressType.BITCOIN_BECH32;
        return UserAddressType.BITCOIN_LEGACY;

      case Blockchain.LIGHTNING:
        if (address.startsWith('$')) return UserAddressType.UMA;
        return LightningHelper.getAddressType(address) as unknown as UserAddressType;

      case Blockchain.MONERO:
        return UserAddressType.MONERO;

      case Blockchain.ZANO:
        return UserAddressType.ZANO;

      case Blockchain.ETHEREUM:
      case Blockchain.SEPOLIA:
      case Blockchain.BINANCE_SMART_CHAIN:
      case Blockchain.POLYGON:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.BASE:
      case Blockchain.GNOSIS:
      case Blockchain.HAQQ:
      case Blockchain.CITREA_TESTNET:
        return UserAddressType.EVM;

      case Blockchain.SOLANA:
        return UserAddressType.SOLANA;

      case Blockchain.TRON:
        return UserAddressType.TRON;

      case Blockchain.LIQUID:
        return UserAddressType.LIQUID;

      case Blockchain.ARWEAVE:
        return UserAddressType.ARWEAVE;

      case Blockchain.CARDANO:
        return UserAddressType.CARDANO;

      case Blockchain.RAILGUN:
        return UserAddressType.RAILGUN;

      default:
        return UserAddressType.OTHER;
    }
  }

  public static getBlockchainsBasedOn(address: string): Blockchain[] {
    if (isEthereumAddress(address)) return this.EthereumBasedChains;
    if (CryptoService.isBitcoinAddress(address)) return [Blockchain.BITCOIN];
    if (CryptoService.isLightningAddress(address)) return [Blockchain.LIGHTNING];
    if (CryptoService.isMoneroAddress(address)) return [Blockchain.MONERO];
    if (CryptoService.isZanoAddress(address)) return [Blockchain.ZANO];
    if (CryptoService.isSolanaAddress(address)) return [Blockchain.SOLANA];
    if (CryptoService.isTronAddress(address)) return [Blockchain.TRON];
    if (CryptoService.isLiquidAddress(address)) return [Blockchain.LIQUID];
    if (CryptoService.isArweaveAddress(address)) return [Blockchain.ARWEAVE];
    if (CryptoService.isCardanoAddress(address)) return [Blockchain.CARDANO];
    if (CryptoService.isRailgunAddress(address)) return [Blockchain.RAILGUN];
    return [Blockchain.DEFICHAIN];
  }

  public static getDefaultBlockchainBasedOn(address: string): Blockchain {
    const chains = this.getBlockchainsBasedOn(address);
    return chains.includes(this.defaultEthereumChain)
      ? this.defaultEthereumChain
      : this.getBlockchainsBasedOn(address)[0];
  }

  private static isBitcoinAddress(address: string): boolean {
    return RegExp(`^(${Config.bitcoinAddressFormat})$`).test(address);
  }

  private static isLightningAddress(address: string): boolean {
    return RegExp(`^(${Config.lightningAddressFormat})$`).test(address);
  }

  private static isMoneroAddress(address: string): boolean {
    return RegExp(`^(${Config.moneroAddressFormat})$`).test(address);
  }

  public static isZanoAddress(address: string): boolean {
    return new RegExp(`^(${Config.zanoAddressFormat})$`).test(address);
  }

  private static isLiquidAddress(address: string): boolean {
    return new RegExp(`^(${Config.liquidAddressFormat})$`).test(address);
  }

  /*
   * The arweave address format also includes all characters of the solana address format.
   * Therefore we have to check, if it is a real arweave address and not a solana address.
   */
  public static isArweaveAddress(address: string): boolean {
    const isAddress = new RegExp(`^(${Config.arweaveAddressFormat})$`).test(address);
    if (!isAddress) return false;

    return !CryptoService.isSolanaAddress(address);
  }

  public static isCardanoAddress(address: string): boolean {
    return new RegExp(`^(${Config.cardanoAddressFormat})$`).test(address);
  }

  public static isRailgunAddress(address: string): boolean {
    return new RegExp(`^(${Config.railgunAddressFormat})$`).test(address);
  }

  public static isSolanaAddress(address: string): boolean {
    return new RegExp(`^(${Config.solanaAddressFormat})$`).test(address);
  }

  public static isTronAddress(address: string): boolean {
    return new RegExp(`^(${Config.tronAddressFormat})$`).test(address);
  }

  // --- SIGNATURE VERIFICATION --- //
  public async verifySignature(message: string, address: string, signature: string, key?: string): Promise<boolean> {
    const blockchain = CryptoService.getDefaultBlockchainBasedOn(address);

    try {
      if (CryptoService.EthereumBasedChains.includes(blockchain))
        return this.verifyEthereumBased(message, address, signature);
      if (blockchain === Blockchain.BITCOIN) return this.verifyBitcoinBased(message, address, signature, null);
      if (blockchain === Blockchain.LIGHTNING) return await this.verifyLightning(address, message, signature);
      if (blockchain === Blockchain.MONERO) return await this.verifyMonero(message, address, signature);
      if (blockchain === Blockchain.ZANO) return await this.verifyZano(message, address, signature);
      if (blockchain === Blockchain.SOLANA) return await this.verifySolana(message, address, signature);
      if (blockchain === Blockchain.TRON) return await this.verifyTron(message, address, signature);
      if (blockchain === Blockchain.LIQUID) return this.verifyLiquid(message, address, signature);
      if (blockchain === Blockchain.ARWEAVE) return await this.verifyArweave(message, signature, key);
      if (blockchain === Blockchain.CARDANO) return this.verifyCardano(message, address, signature, key);
      if (blockchain === Blockchain.RAILGUN) return await this.verifyRailgun(message, address, signature);
      if (blockchain === Blockchain.DEFICHAIN)
        return this.verifyBitcoinBased(message, address, signature, MainNet.messagePrefix);
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

  private async verifyLightning(address: string, message: string, signature: string): Promise<boolean> {
    const key = await this.lightningService.getPublicKeyOfAddress(address);

    return this.lightningService.verifySignature(message, signature, key);
  }

  private async verifyMonero(message: string, address: string, signature: string): Promise<boolean> {
    return this.moneroService.verifySignature(message, address, signature);
  }

  private async verifyZano(message: string, address: string, signature: string): Promise<boolean> {
    return this.zanoService.verifySignature(message, address, signature);
  }

  private async verifySolana(message: string, address: string, signature: string): Promise<boolean> {
    return this.solanaService.verifySignature(message, address, signature);
  }

  private async verifyTron(message: string, address: string, signature: string): Promise<boolean> {
    return this.tronService.verifySignature(message, address, signature);
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

  private async verifyRailgun(message: string, address: string, signature: string): Promise<boolean> {
    return this.railgunService.verifySignature(message, address, signature);
  }
}
