import { BadRequestException, Injectable } from '@nestjs/common';
import { Verifier } from 'bip322-js';
import { verify } from 'bitcoinjs-message';
import { isEthereumAddress } from 'class-validator';
import { Contract, ethers } from 'ethers';
import { hashMessage, verifyMessage } from 'ethers/lib/utils';
import { Config, GetConfig } from 'src/config/config';
import ERC1271_ABI from 'src/integration/blockchain/shared/evm/abi/erc1271.abi.json';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { RailgunService } from 'src/integration/railgun/railgun.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
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
  private readonly logger = new DfxLogger(CryptoService);

  private static readonly defaultEthereumChain = Blockchain.ETHEREUM;
  private static readonly ERC1271_MAGIC_VALUE = '0x1626ba7e';

  // ERC-1271 providers for each EVM chain
  private readonly evmProviders: Map<Blockchain, ethers.providers.StaticJsonRpcProvider> = new Map();

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
  ) {
    this.initializeEvmProviders();
  }

  private initializeEvmProviders(): void {
    const config = GetConfig().blockchain;

    const chainConfigs: { blockchain: Blockchain; gatewayUrl: string; apiKey?: string; chainId: number }[] = [
      {
        blockchain: Blockchain.ETHEREUM,
        gatewayUrl: config.ethereum.ethGatewayUrl,
        apiKey: config.ethereum.ethApiKey,
        chainId: config.ethereum.ethChainId,
      },
      {
        blockchain: Blockchain.SEPOLIA,
        gatewayUrl: config.sepolia.sepoliaGatewayUrl,
        apiKey: config.sepolia.sepoliaApiKey,
        chainId: config.sepolia.sepoliaChainId,
      },
      {
        blockchain: Blockchain.ARBITRUM,
        gatewayUrl: config.arbitrum.arbitrumGatewayUrl,
        apiKey: config.arbitrum.arbitrumApiKey,
        chainId: config.arbitrum.arbitrumChainId,
      },
      {
        blockchain: Blockchain.OPTIMISM,
        gatewayUrl: config.optimism.optimismGatewayUrl,
        apiKey: config.optimism.optimismApiKey,
        chainId: config.optimism.optimismChainId,
      },
      {
        blockchain: Blockchain.POLYGON,
        gatewayUrl: config.polygon.polygonGatewayUrl,
        apiKey: config.polygon.polygonApiKey,
        chainId: config.polygon.polygonChainId,
      },
      {
        blockchain: Blockchain.BASE,
        gatewayUrl: config.base.baseGatewayUrl,
        apiKey: config.base.baseApiKey,
        chainId: config.base.baseChainId,
      },
      {
        blockchain: Blockchain.GNOSIS,
        gatewayUrl: config.gnosis.gnosisGatewayUrl,
        apiKey: config.gnosis.gnosisApiKey,
        chainId: config.gnosis.gnosisChainId,
      },
      {
        blockchain: Blockchain.BINANCE_SMART_CHAIN,
        gatewayUrl: config.bsc.bscGatewayUrl,
        apiKey: config.bsc.bscApiKey,
        chainId: config.bsc.bscChainId,
      },
      {
        blockchain: Blockchain.CITREA_TESTNET,
        gatewayUrl: config.citreaTestnet.citreaTestnetGatewayUrl,
        apiKey: config.citreaTestnet.citreaTestnetApiKey,
        chainId: config.citreaTestnet.citreaTestnetChainId,
      },
    ];

    for (const { blockchain, gatewayUrl, apiKey, chainId } of chainConfigs) {
      if (gatewayUrl) {
        const url = apiKey ? `${gatewayUrl}/${apiKey}` : gatewayUrl;
        this.evmProviders.set(blockchain, new ethers.providers.StaticJsonRpcProvider(url, chainId));
      }
    }
  }

  private getEvmProvider(blockchain?: Blockchain): ethers.providers.StaticJsonRpcProvider | undefined {
    const chain = blockchain ?? CryptoService.defaultEthereumChain;
    return this.evmProviders.get(chain);
  }

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

      case Blockchain.SPARK:
        return this.sparkService.getPaymentRequest(address, amount);

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

      case Blockchain.CARDANO:
        return this.cardanoService.getPaymentRequest(address, amount);

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

      case Blockchain.SPARK:
        return UserAddressType.SPARK;

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
    if (CryptoService.isDefichainAddress(address)) return [Blockchain.DEFICHAIN];
    return [];
  }

  public static getDefaultBlockchainBasedOn(address: string): Blockchain {
    const chains = this.getBlockchainsBasedOn(address);
    if (chains.length === 0) throw new BadRequestException('Unsupported blockchain address');
    return chains.includes(this.defaultEthereumChain) ? this.defaultEthereumChain : chains[0];
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

  private static isDefichainAddress(address: string): boolean {
    return new RegExp(`^(${Config.defichainAddressFormat})$`).test(address);
  }

  // --- SIGNATURE VERIFICATION --- //
  public async verifySignature(
    message: string,
    address: string,
    signature: string,
    key?: string,
    blockchain?: Blockchain,
  ): Promise<boolean> {
    const detectedBlockchain = CryptoService.getDefaultBlockchainBasedOn(address);

    try {
      if (EvmBlockchains.includes(detectedBlockchain))
        return await this.verifyEthereumBased(message, address, signature, blockchain);
      if (detectedBlockchain === Blockchain.BITCOIN) return this.verifyBitcoinBased(message, address, signature, null);
      if (detectedBlockchain === Blockchain.LIGHTNING) return await this.verifyLightning(address, message, signature);
      if (detectedBlockchain === Blockchain.SPARK) return await this.verifySpark(message, address, signature);
      if (detectedBlockchain === Blockchain.MONERO) return await this.verifyMonero(message, address, signature);
      if (detectedBlockchain === Blockchain.ZANO) return await this.verifyZano(message, address, signature);
      if (detectedBlockchain === Blockchain.SOLANA) return await this.verifySolana(message, address, signature);
      if (detectedBlockchain === Blockchain.TRON) return await this.verifyTron(message, address, signature);
      if (detectedBlockchain === Blockchain.LIQUID) return this.verifyLiquid(message, address, signature);
      if (detectedBlockchain === Blockchain.ARWEAVE) return await this.verifyArweave(message, signature, key);
      if (detectedBlockchain === Blockchain.CARDANO) return this.verifyCardano(message, address, signature, key);
      if (detectedBlockchain === Blockchain.RAILGUN) return await this.verifyRailgun(message, address, signature);
    } catch (e) {
      if (e instanceof SignatureException) throw new BadRequestException(e.message);
    }

    return false;
  }

  private async verifyEthereumBased(
    message: string,
    address: string,
    signature: string,
    blockchain?: Blockchain,
  ): Promise<boolean> {
    // there are signatures out there, which do not have '0x' in the beginning, but for verification this is needed
    const signatureToUse = signature.startsWith('0x') ? signature : '0x' + signature;

    const provider = this.getEvmProvider(blockchain);
    if (!provider) {
      this.logger.warn(`No EVM provider for blockchain ${blockchain}, falling back to EOA verification`);
      return verifyMessage(message, signatureToUse).toLowerCase() === address.toLowerCase();
    }

    // Check if address is a smart contract (ERC-1271)
    // On RPC failure, fall back to EOA verification to avoid blocking all EVM auth
    try {
      const code = await provider.getCode(address);
      if (code !== '0x') {
        return await this.verifyErc1271Signature(message, address, signatureToUse, provider, blockchain);
      }
    } catch (e) {
      this.logger.warn(`Failed to check contract code for ${address}, falling back to EOA verification: ${e.message}`);
    }

    // Standard EOA verification
    return verifyMessage(message, signatureToUse).toLowerCase() === address.toLowerCase();
  }

  private async verifyErc1271Signature(
    message: string,
    address: string,
    signature: string,
    provider: ethers.providers.StaticJsonRpcProvider,
    blockchain?: Blockchain,
  ): Promise<boolean> {
    try {
      const hash = hashMessage(message);
      const contract = new Contract(address, ERC1271_ABI, provider);
      const result = await contract.isValidSignature(hash, signature);
      const isValid = result === CryptoService.ERC1271_MAGIC_VALUE;

      const chainInfo = blockchain ? ` on ${blockchain}` : '';
      if (isValid) {
        this.logger.verbose(`ERC-1271 signature verified for contract wallet ${address}${chainInfo}`);
      } else {
        this.logger.verbose(`ERC-1271 signature invalid for ${address}${chainInfo}: returned ${result}`);
      }

      return isValid;
    } catch (e) {
      this.logger.verbose(`ERC-1271 verification failed for ${address}: ${e.message}`);
      return false;
    }
  }

  private verifyBitcoinBased(message: string, address: string, signature: string, prefix: string | null): boolean {
    let isValid = false;

    try {
      isValid = Verifier.verifySignature(address, message, signature, true);
    } catch {
      // ignore - try next verification method
    }

    if (!isValid) {
      try {
        isValid = verify(message, address, signature, prefix, true); // ← WICHTIG: electrum=true
      } catch {
        // ignore - try next verification method
      }
    }

    if (!isValid) {
      try {
        isValid = verify(message, address, signature, prefix);
      } catch {
        // ignore - verification failed
      }
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
