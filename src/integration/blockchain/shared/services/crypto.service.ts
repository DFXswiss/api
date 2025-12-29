import { MainNet } from '@defichain/jellyfish-network';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Verifier } from 'bip322-js';
import { verify } from 'bitcoinjs-message';
import { isEthereumAddress } from 'class-validator';
import { verifyMessage } from 'ethers/lib/utils';
import { Config } from 'src/config/config';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { RailgunService } from 'src/integration/railgun/railgun.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { UserAddressType } from 'src/subdomains/generic/user/models/user/user.enum';
import { ArweaveService } from '../../arweave/services/arweave.service';
import { BitcoinService } from '../../bitcoin/node/bitcoin.service';
import { LiquidHelper } from '../../liquid/liquid-helper';
import { MoneroService } from '../../monero/services/monero.service';
import { SolanaService } from '../../solana/services/solana.service';
import { SparkService } from '../../spark/spark.service';
import { TronService } from '../../tron/services/tron.service';
import { CardanoService } from '../../cardano/services/cardano.service';
import { ZanoService } from '../../zano/services/zano.service';
import { Blockchain } from '../enums/blockchain.enum';
import { EvmUtil } from '../evm/evm.util';
import { SignatureException } from '../exceptions/signature.exception';
import { EvmBlockchains, TestBlockchains } from '../util/blockchain.util';

@Injectable()
export class CryptoService {
  private static readonly defaultEthereumChain = Blockchain.ETHEREUM;

  constructor(
    private readonly bitcoinService: BitcoinService,
    private readonly lightningService: LightningService,
    private readonly sparkService: SparkService,
    private readonly moneroService: MoneroService,
    private readonly zanoService: ZanoService,
    private readonly solanaService: SolanaService,
    private readonly tronService: TronService,
    private readonly cardanoService: CardanoService,
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

    if (asset.blockchain === Blockchain.BITCOIN) return this.bitcoinService.getPaymentRequest(address, amount, label);
    if (asset.blockchain === Blockchain.LIGHTNING) return this.lightningService.getInvoiceByLnurlp(address, amount);
    if (asset.blockchain === Blockchain.SPARK) return this.sparkService.getPaymentRequest(address, amount);
    if (asset.blockchain === Blockchain.MONERO) return this.moneroService.getPaymentRequest(address, amount);
    if (asset.blockchain === Blockchain.ZANO) return this.zanoService.getPaymentRequest(address, amount);
    if (asset.blockchain === Blockchain.SOLANA) return this.solanaService.getPaymentRequest(address, amount);
    if (asset.blockchain === Blockchain.TRON) return this.tronService.getPaymentRequest(address, amount);
    if (asset.blockchain === Blockchain.CARDANO) return this.cardanoService.getPaymentRequest(address, amount);

    // Standard EVM chains
    if (EvmBlockchains.includes(asset.blockchain)) return EvmUtil.getPaymentRequest(address, asset, amount);

    return undefined;
  }

  // --- ADDRESSES --- //
  public static getAddressType(address: string): UserAddressType {
    const blockchain = CryptoService.getDefaultBlockchainBasedOn(address);

    if (blockchain === Blockchain.BITCOIN) {
      return address.startsWith('bc1') ? UserAddressType.BITCOIN_BECH32 : UserAddressType.BITCOIN_LEGACY;
    }
    if (blockchain === Blockchain.LIGHTNING) {
      return address.startsWith('$') ? UserAddressType.UMA : LightningHelper.getAddressType(address) as unknown as UserAddressType;
    }
    if (blockchain === Blockchain.SPARK) return UserAddressType.SPARK;
    if (blockchain === Blockchain.MONERO) return UserAddressType.MONERO;
    if (blockchain === Blockchain.ZANO) return UserAddressType.ZANO;
    if (blockchain === Blockchain.SOLANA) return UserAddressType.SOLANA;
    if (blockchain === Blockchain.TRON) return UserAddressType.TRON;
    if (blockchain === Blockchain.LIQUID) return UserAddressType.LIQUID;
    if (blockchain === Blockchain.ARWEAVE) return UserAddressType.ARWEAVE;
    if (blockchain === Blockchain.CARDANO) return UserAddressType.CARDANO;
    if (blockchain === Blockchain.RAILGUN) return UserAddressType.RAILGUN;

    // Standard EVM chains
    if (EvmBlockchains.includes(blockchain)) return UserAddressType.EVM;

    return UserAddressType.OTHER;
  }

  public static getBlockchainsBasedOn(address: string): Blockchain[] {
    return CryptoService.getAllBlockchainsBasedOn(address).filter((b) => !TestBlockchains.includes(b));
  }

  private static getAllBlockchainsBasedOn(address: string): Blockchain[] {
    if (isEthereumAddress(address)) return EvmBlockchains;
    if (CryptoService.isBitcoinAddress(address)) return [Blockchain.BITCOIN];
    if (CryptoService.isLightningAddress(address)) return [Blockchain.LIGHTNING];
    if (CryptoService.isSparkAddress(address)) return [Blockchain.SPARK];
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

  private static isSparkAddress(address: string): boolean {
    return RegExp(`^(${Config.sparkAddressFormat})$`).test(address);
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
      if (EvmBlockchains.includes(blockchain)) return this.verifyEthereumBased(message, address, signature);
      if (blockchain === Blockchain.BITCOIN) return this.verifyBitcoinBased(message, address, signature, null);
      if (blockchain === Blockchain.LIGHTNING) return await this.verifyLightning(address, message, signature);
      if (blockchain === Blockchain.SPARK) return await this.verifySpark(message, address, signature);
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
    } catch (e) {
      if (e instanceof SignatureException) throw new BadRequestException(e.message);
    }

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
      isValid = Verifier.verifySignature(address, message, signature, true);
    } catch {}

    if (!isValid) {
      try {
        isValid = verify(message, address, signature, prefix, true); // ← WICHTIG: electrum=true
      } catch {}
    }

    if (!isValid) {
      try {
        isValid = verify(message, address, signature, prefix);
      } catch {}
    }

    return isValid;
  }

  private async verifyLightning(address: string, message: string, signature: string): Promise<boolean> {
    const key = await this.lightningService.getPublicKeyOfAddress(address).catch(() => {
      throw new SignatureException('Failed to get node public key (by invoice)');
    });

    return this.lightningService.verifySignature(message, signature, key);
  }

  private async verifySpark(message: string, address: string, signature: string): Promise<boolean> {
    return this.sparkService.verifySignature(message, address, signature);
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
    return this.cardanoService.verifySignature(message, address, signature, key);
  }

  private async verifyArweave(message: string, signature: string, key: string): Promise<boolean> {
    return this.arweaveService.verifySignature(message, signature, key);
  }

  private async verifyRailgun(message: string, address: string, signature: string): Promise<boolean> {
    return this.railgunService.verifySignature(message, address, signature);
  }
}
