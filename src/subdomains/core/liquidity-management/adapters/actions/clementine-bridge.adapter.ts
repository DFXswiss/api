import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { BitcoinTestnet4Service } from 'src/integration/blockchain/bitcoin-testnet4/bitcoin-testnet4.service';
import { BitcoinTestnet4FeeService } from 'src/integration/blockchain/bitcoin-testnet4/services/bitcoin-testnet4-fee.service';
import { BitcoinBasedClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-based-client';
import { BitcoinNodeType, BitcoinService } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { CitreaTestnetService } from 'src/integration/blockchain/citrea-testnet/citrea-testnet.service';
import { CitreaClient } from 'src/integration/blockchain/citrea/citrea-client';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import {
  CLEMENTINE_BRIDGE_AMOUNT_BTC,
  CLEMENTINE_WITHDRAWAL_DUST_BTC,
  ClementineClient,
  ClementineNetwork,
  WithdrawStatus,
} from 'src/integration/blockchain/clementine/clementine-client';
import { ClementineService } from 'src/integration/blockchain/clementine/clementine.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { isAsset } from 'src/shared/models/active';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

export enum ClementineBridgeCommands {
  DEPOSIT = 'deposit', // BTC -> cBTC (10 BTC fixed)
  WITHDRAW = 'withdraw', // cBTC -> BTC (10 cBTC fixed)
}

/**
 * Correlation ID format for tracking operations:
 * - Deposit: clementine:deposit:{depositAddress}:{btcTxId}
 * - Withdraw: clementine:withdraw:{step}:{signerAddress}:{destinationAddress}:{withdrawalUtxo}:{optimisticSig}:{operatorSig}
 *
 * Withdrawal steps: dust_sent, scanning, signatures_generated, sent_to_bridge, waiting_optimistic, sent_to_operators
 */
const CORRELATION_PREFIX = {
  DEPOSIT: 'clementine:deposit:',
  WITHDRAW: 'clementine:withdraw:',
};

// 12 hours in milliseconds for optimistic withdrawal timeout
const OPTIMISTIC_TIMEOUT_MS = 12 * 60 * 60 * 1000;

// Bitcoin address prefixes by network
const BTC_ADDRESS_PREFIXES: Record<ClementineNetwork, string[]> = {
  [ClementineNetwork.BITCOIN]: ['bc1', '1', '3'],
  [ClementineNetwork.TESTNET4]: ['tb1', 'bcrt1', 'm', 'n', '2'],
};

// Expected Bitcoin chain names by network
const BTC_CHAIN_NAMES: Record<ClementineNetwork, string> = {
  [ClementineNetwork.BITCOIN]: 'main',
  [ClementineNetwork.TESTNET4]: 'testnet4',
};

// Expected Citrea chain IDs by network
const CITREA_CHAIN_IDS: Record<ClementineNetwork, number> = {
  [ClementineNetwork.BITCOIN]: 4114, // Citrea mainnet
  [ClementineNetwork.TESTNET4]: 5115, // Citrea testnet
};

interface WithdrawCorrelationData {
  step: string;
  signerAddress: string;
  destinationAddress: string;
  withdrawalUtxo?: string;
  optimisticSignature?: string;
  operatorPaidSignature?: string;
  sentToBridgeAt?: number;
}

@Injectable()
export class ClementineBridgeAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(ClementineBridgeAdapter);

  protected commands = new Map<string, Command>();

  private readonly clementineClient: ClementineClient;
  private readonly bitcoinClient: BitcoinBasedClient;
  private readonly citreaClient: CitreaClient;
  private readonly recoveryTaprootAddress: string;
  private readonly signerAddress: string;
  private readonly network: ClementineNetwork;
  private readonly expectedCliVersion: string;
  private networkValidated = false;

  constructor(
    clementineService: ClementineService,
    bitcoinService: BitcoinService,
    bitcoinTestnet4Service: BitcoinTestnet4Service,
    citreaService: CitreaService,
    citreaTestnetService: CitreaTestnetService,
    private readonly assetService: AssetService,
    private readonly bitcoinFeeService: BitcoinFeeService,
    private readonly bitcoinTestnet4FeeService: BitcoinTestnet4FeeService,
  ) {
    super(LiquidityManagementSystem.CLEMENTINE_BRIDGE);

    const config = GetConfig().blockchain.clementine;
    this.network = config.network;
    this.recoveryTaprootAddress = config.recoveryTaprootAddress;
    this.signerAddress = config.signerAddress;
    this.expectedCliVersion = config.expectedVersion;

    this.clementineClient = clementineService.getDefaultClient();
    this.bitcoinClient = this.isTestnet
      ? bitcoinTestnet4Service.getDefaultClient()
      : bitcoinService.getDefaultClient(BitcoinNodeType.BTC_OUTPUT);
    this.citreaClient = this.isTestnet
      ? citreaTestnetService.getDefaultClient<CitreaClient>()
      : citreaService.getDefaultClient<CitreaClient>();

    this.commands.set(ClementineBridgeCommands.DEPOSIT, this.deposit.bind(this));
    this.commands.set(ClementineBridgeCommands.WITHDRAW, this.withdraw.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      action: { command },
    } = order;

    if (command === ClementineBridgeCommands.DEPOSIT) {
      return this.checkDepositCompletion(order);
    } else if (command === ClementineBridgeCommands.WITHDRAW) {
      return this.checkWithdrawCompletion(order);
    }

    throw new OrderFailedException(`Unknown command: ${command}`);
  }

  validateParams(_command: string, _params: Record<string, unknown>): boolean {
    // Clementine bridge doesn't require additional params
    return true;
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  /**
   * Deposit BTC to receive cBTC on Citrea
   * Note: Clementine uses a fixed bridge amount of 10 BTC
   */
  private async deposit(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset: citreaAsset },
      },
    } = order;

    // Validate asset is cBTC on Citrea
    if (citreaAsset.type !== AssetType.COIN || citreaAsset.blockchain !== this.citreaBlockchain) {
      throw new OrderNotProcessableException(
        `Clementine deposit only supports cBTC (native coin) on ${this.citreaBlockchain}`,
      );
    }

    // Validate configuration
    this.validateRecoveryAddress();

    // Validate network consistency on first use
    await this.validateNetworkConsistency();

    // Get the corresponding Bitcoin asset
    const bitcoinAsset = await this.getBtcAsset();

    // Check BTC balance on Bitcoin node - must have at least 10 BTC (fixed bridge amount)
    const btcBalance = await this.bitcoinClient.getNativeCoinBalance();
    if (btcBalance < CLEMENTINE_BRIDGE_AMOUNT_BTC) {
      throw new OrderNotProcessableException(
        `Not enough BTC for Clementine bridge (balance: ${btcBalance}, required: ${CLEMENTINE_BRIDGE_AMOUNT_BTC} BTC)`,
      );
    }

    // Start deposit with Clementine CLI
    const citreaAddress = this.citreaClient.walletAddress;
    const { depositAddress } = await this.clementineClient.depositStart(this.recoveryTaprootAddress, citreaAddress);

    this.logger.info(
      `Deposit address generated: ${depositAddress}, recovery: ${this.recoveryTaprootAddress}, citrea: ${citreaAddress}`,
    );

    // Update order with fixed amount
    order.inputAmount = CLEMENTINE_BRIDGE_AMOUNT_BTC;
    order.inputAsset = bitcoinAsset.name;
    order.outputAsset = citreaAsset.name;

    // Send BTC to the deposit address
    const btcTxId = await this.sendBtcToAddress(depositAddress, CLEMENTINE_BRIDGE_AMOUNT_BTC);

    // Store deposit address and txId in correlation ID for status checks
    return `${CORRELATION_PREFIX.DEPOSIT}${depositAddress}:${btcTxId}`;
  }

  /**
   * Withdraw cBTC to receive BTC on Bitcoin
   * Note: Clementine uses a fixed bridge amount of 10 BTC
   *
   * Withdrawal is a multi-step process:
   * 1. Call withdraw start
   * 2. Send 330 satoshis to signer address
   * 3. Scan for UTXO
   * 4. Generate signatures
   * 5. Send to bridge contract (burns cBTC)
   * 6. Wait for optimistic withdrawal (12 hours)
   * 7. If not complete, send to operators
   */
  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset: bitcoinAsset },
      },
    } = order;

    // Validate asset is BTC on Bitcoin
    if (bitcoinAsset.type !== AssetType.COIN || bitcoinAsset.blockchain !== this.btcBlockchain) {
      throw new OrderNotProcessableException(
        `Clementine withdraw only supports BTC (native coin) on ${this.btcBlockchain}`,
      );
    }

    // Validate configuration
    this.validateSignerAddress();

    // Validate network consistency on first use
    await this.validateNetworkConsistency();

    // Get the corresponding Citrea cBTC asset
    const citreaAsset = await this.getCitreaAsset();

    // Check cBTC balance on Citrea - must have at least 10 cBTC (fixed bridge amount)
    const cbtcBalance = await this.citreaClient.getNativeCoinBalance();
    if (cbtcBalance < CLEMENTINE_BRIDGE_AMOUNT_BTC) {
      throw new OrderNotProcessableException(
        `Not enough cBTC for Clementine bridge (balance: ${cbtcBalance}, required: ${CLEMENTINE_BRIDGE_AMOUNT_BTC} cBTC)`,
      );
    }

    // Get destination address (our Bitcoin wallet)
    const destinationAddress = this.bitcoinClient.walletAddress;

    // Step 1: Start withdrawal
    await this.clementineClient.withdrawStart(this.signerAddress, destinationAddress);
    this.logger.verbose(`Withdrawal started for ${this.signerAddress} -> ${destinationAddress}`);

    // Step 2: Send 330 satoshis to signer address to create withdrawal UTXO
    // Strip 'wit' prefix as Bitcoin nodes only accept standard addresses
    const signerBtcAddress = this.signerAddress.replace(/^wit/, '');
    const dustTxId = await this.sendBtcToAddress(signerBtcAddress, CLEMENTINE_WITHDRAWAL_DUST_BTC);
    this.logger.verbose(`Sent ${CLEMENTINE_WITHDRAWAL_DUST_BTC} BTC (330 sats) to signer: ${dustTxId}`);

    // Update order with fixed amount
    order.inputAmount = CLEMENTINE_BRIDGE_AMOUNT_BTC;
    order.inputAsset = citreaAsset.name;
    order.outputAsset = bitcoinAsset.name;

    // Store withdrawal state in correlation ID
    const correlationData: WithdrawCorrelationData = {
      step: 'dust_sent',
      signerAddress: this.signerAddress,
      destinationAddress,
    };

    return `${CORRELATION_PREFIX.WITHDRAW}${this.encodeWithdrawCorrelation(correlationData)}`;
  }

  //*** COMPLETION CHECKS ***//

  private async checkDepositCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { target: asset },
      },
    } = order;

    if (!isAsset(asset)) {
      throw new Error('ClementineBridgeAdapter.checkDepositCompletion(...) supports only Asset instances as an input.');
    }

    try {
      // Extract deposit address and BTC txId from correlation ID
      const correlationData = order.correlationId.replace(CORRELATION_PREFIX.DEPOSIT, '');
      const [depositAddress, btcTxId] = correlationData.split(':');

      // Step 1: Verify the Bitcoin transaction is confirmed
      if (btcTxId) {
        const isConfirmed = await this.bitcoinClient.isTxComplete(btcTxId, 6); // Clementine requires 6+ confirmations
        if (!isConfirmed) {
          this.logger.verbose(`Deposit ${depositAddress}: BTC transaction not yet confirmed (need 6+)`);
          return false;
        }
      }

      // Step 2: Check Clementine deposit status
      const depositStatus = await this.clementineClient.depositStatus(depositAddress);
      this.logger.verbose(`Deposit ${depositAddress}: Clementine status = ${depositStatus.status}`);

      if (depositStatus.status === 'failed') {
        throw new OrderFailedException(`Clementine deposit failed: ${depositStatus.errorMessage ?? 'Unknown error'}`);
      }

      if (depositStatus.status === 'completed') {
        order.outputAmount = CLEMENTINE_BRIDGE_AMOUNT_BTC;
        return true;
      }

      return false;
    } catch (e) {
      throw e instanceof OrderFailedException ? e : new OrderFailedException(e.message);
    }
  }

  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { target: asset },
      },
    } = order;

    if (!isAsset(asset)) {
      throw new Error(
        'ClementineBridgeAdapter.checkWithdrawCompletion(...) supports only Asset instances as an input.',
      );
    }

    try {
      const correlationData = this.decodeWithdrawCorrelation(
        order.correlationId.replace(CORRELATION_PREFIX.WITHDRAW, ''),
      );

      this.logger.verbose(`Withdrawal check: step=${correlationData.step}`);

      // Process based on current step
      switch (correlationData.step) {
        case 'dust_sent':
          return await this.processWithdrawScanStep(order, correlationData);

        case 'scanning':
          return await this.processWithdrawScanStep(order, correlationData);

        case 'signatures_generated':
          return await this.processWithdrawSendStep(order, correlationData);

        case 'sent_to_bridge':
          return await this.processWithdrawWaitStep(order, correlationData);

        case 'waiting_optimistic':
          return await this.processWithdrawOptimisticStep(order, correlationData);

        case 'sent_to_operators':
          return await this.processWithdrawFinalStep(order, correlationData);

        default:
          throw new OrderFailedException(`Unknown withdrawal step: ${correlationData.step}`);
      }
    } catch (e) {
      throw e instanceof OrderFailedException ? e : new OrderFailedException(e.message);
    }
  }

  private async processWithdrawScanStep(
    order: LiquidityManagementOrder,
    data: WithdrawCorrelationData,
  ): Promise<boolean> {
    // Scan for withdrawal UTXO
    const scanResult = await this.clementineClient.withdrawScan(data.signerAddress, data.destinationAddress);

    if (!scanResult) {
      this.logger.verbose(`Withdrawal: no UTXO found yet, still scanning`);
      data.step = 'scanning';
      order.correlationId = `${CORRELATION_PREFIX.WITHDRAW}${this.encodeWithdrawCorrelation(data)}`;
      return false;
    }

    this.logger.verbose(`Withdrawal: found UTXO ${scanResult.withdrawalUtxo}`);
    data.withdrawalUtxo = scanResult.withdrawalUtxo;

    // Generate signatures
    const signatures = await this.clementineClient.withdrawGenerateSignatures(
      data.signerAddress,
      data.destinationAddress,
      data.withdrawalUtxo,
    );

    data.optimisticSignature = signatures.optimisticSignature;
    data.operatorPaidSignature = signatures.operatorPaidSignature;
    data.step = 'signatures_generated';

    this.logger.info(
      `Withdrawal signatures generated for UTXO ${data.withdrawalUtxo}, ` +
        `signer: ${data.signerAddress}, destination: ${data.destinationAddress}`,
    );
    order.correlationId = `${CORRELATION_PREFIX.WITHDRAW}${this.encodeWithdrawCorrelation(data)}`;
    return false;
  }

  private async processWithdrawSendStep(
    order: LiquidityManagementOrder,
    data: WithdrawCorrelationData,
  ): Promise<boolean> {
    // Idempotency check: verify if withdrawal was already sent to bridge
    // This prevents double cBTC burning if the process crashes after withdrawSend()
    // but before the correlationId is persisted
    const existingStatus = await this.clementineClient.withdrawStatus(data.withdrawalUtxo);

    // Only proceed with withdrawSend() if NO withdrawal exists for this UTXO
    // If status is anything other than NOT_FOUND, the withdrawal was already submitted
    if (existingStatus.status !== WithdrawStatus.NOT_FOUND) {
      this.logger.info(
        `Withdrawal: already submitted to bridge (status: ${existingStatus.status}), skipping withdrawSend()`,
      );

      // Already submitted - move to next step without calling withdrawSend() again
      data.step = 'sent_to_bridge';
      // Use order.updated as fallback timestamp since we don't know the exact time
      data.sentToBridgeAt = data.sentToBridgeAt ?? order.updated.getTime();

      order.correlationId = `${CORRELATION_PREFIX.WITHDRAW}${this.encodeWithdrawCorrelation(data)}`;
      return false;
    }

    // Send to bridge contract (burns cBTC)
    await this.clementineClient.withdrawSend(
      data.signerAddress,
      data.destinationAddress,
      data.withdrawalUtxo,
      data.optimisticSignature,
    );

    data.step = 'sent_to_bridge';
    data.sentToBridgeAt = Date.now();

    this.logger.verbose(`Withdrawal: sent to bridge contract`);
    order.correlationId = `${CORRELATION_PREFIX.WITHDRAW}${this.encodeWithdrawCorrelation(data)}`;
    return false;
  }

  private async processWithdrawWaitStep(
    order: LiquidityManagementOrder,
    data: WithdrawCorrelationData,
  ): Promise<boolean> {
    // Check status
    const status = await this.clementineClient.withdrawStatus(data.withdrawalUtxo);
    this.logger.verbose(`Withdrawal: status = ${status.status}`);

    if (status.status === 'failed') {
      throw new OrderFailedException(`Clementine withdrawal failed: ${status.errorMessage ?? 'Unknown error'}`);
    }

    if (status.status === 'completed') {
      order.outputAmount = CLEMENTINE_BRIDGE_AMOUNT_BTC;
      return true;
    }

    // Move to waiting_optimistic state
    data.step = 'waiting_optimistic';
    order.correlationId = `${CORRELATION_PREFIX.WITHDRAW}${this.encodeWithdrawCorrelation(data)}`;
    return false;
  }

  private async processWithdrawOptimisticStep(
    order: LiquidityManagementOrder,
    data: WithdrawCorrelationData,
  ): Promise<boolean> {
    // Check status
    const status = await this.clementineClient.withdrawStatus(data.withdrawalUtxo);
    this.logger.verbose(`Withdrawal: optimistic status = ${status.status}`);

    if (status.status === 'failed') {
      throw new OrderFailedException(`Clementine withdrawal failed: ${status.errorMessage ?? 'Unknown error'}`);
    }

    if (status.status === 'completed') {
      order.outputAmount = CLEMENTINE_BRIDGE_AMOUNT_BTC;
      return true;
    }

    // Check if 12 hours have passed - if so, send to operators
    // Use order.updated as fallback if sentToBridgeAt is missing (e.g., due to data loss or migration)
    let sentTimestamp = data.sentToBridgeAt;
    if (!sentTimestamp) {
      this.logger.warn('Withdrawal: sentToBridgeAt missing, using order.updated as fallback for timeout calculation');
      sentTimestamp = order.updated.getTime();

      // Persist the fallback timestamp for future checks
      data.sentToBridgeAt = sentTimestamp;
      order.correlationId = `${CORRELATION_PREFIX.WITHDRAW}${this.encodeWithdrawCorrelation(data)}`;
    }
    const elapsed = Date.now() - sentTimestamp;
    if (elapsed > OPTIMISTIC_TIMEOUT_MS) {
      this.logger.verbose(`Withdrawal: 12 hours elapsed, sending to operators`);

      await this.clementineClient.withdrawSendToOperators(
        data.signerAddress,
        data.destinationAddress,
        data.withdrawalUtxo,
        data.operatorPaidSignature,
      );

      data.step = 'sent_to_operators';
      order.correlationId = `${CORRELATION_PREFIX.WITHDRAW}${this.encodeWithdrawCorrelation(data)}`;
    }

    return false;
  }

  private async processWithdrawFinalStep(
    order: LiquidityManagementOrder,
    data: WithdrawCorrelationData,
  ): Promise<boolean> {
    // Check status after sending to operators
    const status = await this.clementineClient.withdrawStatus(data.withdrawalUtxo);
    this.logger.verbose(`Withdrawal: final status = ${status.status}`);

    if (status.status === 'failed') {
      throw new OrderFailedException(`Clementine withdrawal failed: ${status.errorMessage ?? 'Unknown error'}`);
    }

    if (status.status === 'completed') {
      order.outputAmount = CLEMENTINE_BRIDGE_AMOUNT_BTC;
      return true;
    }

    return false;
  }

  //*** HELPER METHODS ***//

  private async sendBtcToAddress(address: string, amount: number): Promise<string> {
    // Validate address format before sending
    if (!this.isValidBitcoinAddress(address)) {
      throw new OrderFailedException(`Invalid Bitcoin address format: ${address}`);
    }

    const feeRate = await this.getFeeRate();
    const txId = await this.bitcoinClient.sendMany([{ addressTo: address, amount }], feeRate);

    if (!txId) {
      throw new OrderFailedException(`Failed to send BTC to address ${address}`);
    }

    this.logger.info(`Sent ${amount} BTC to ${address}, txId: ${txId}`);

    return txId;
  }

  /**
   * Validates Bitcoin address format (basic validation).
   * Checks length and prefix for the configured network.
   */
  private isValidBitcoinAddress(address: string): boolean {
    if (!address || address.length < 26 || address.length > 90) {
      return false;
    }

    // Must match expected network prefixes
    if (!this.isAddressForNetwork(address, this.network)) {
      return false;
    }

    // Bech32/Bech32m addresses (bc1/tb1) should be lowercase
    if (address.startsWith('bc1') || address.startsWith('tb1') || address.startsWith('bcrt1')) {
      if (address !== address.toLowerCase()) {
        return false;
      }
    }

    return true;
  }

  private encodeWithdrawCorrelation(data: WithdrawCorrelationData): string {
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  private decodeWithdrawCorrelation(encoded: string): WithdrawCorrelationData {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  }

  //*** ADDRESS VALIDATION ***//

  /**
   * Validates the recovery taproot address configuration.
   * Must be present, have 'dep' prefix, and underlying address must match network.
   */
  private validateRecoveryAddress(): void {
    if (!this.recoveryTaprootAddress) {
      throw new OrderNotProcessableException('Clementine recovery taproot address not configured');
    }

    // Must have 'dep' prefix
    if (!this.recoveryTaprootAddress.startsWith('dep')) {
      throw new OrderNotProcessableException(
        `Clementine recovery address must have 'dep' prefix, got: ${this.recoveryTaprootAddress}`,
      );
    }

    // Underlying address must be valid
    const underlyingAddress = this.recoveryTaprootAddress.replace(/^dep/, '');
    if (!this.isValidBitcoinAddress(underlyingAddress)) {
      throw new OrderNotProcessableException(
        `Clementine recovery address has invalid underlying Bitcoin address: ${underlyingAddress}`,
      );
    }

    this.logger.verbose(`Recovery address validated: ${this.recoveryTaprootAddress}`);
  }

  /**
   * Validates the signer address configuration.
   * Must be present, have 'wit' prefix, and underlying address must match network.
   */
  private validateSignerAddress(): void {
    if (!this.signerAddress) {
      throw new OrderNotProcessableException('Clementine signer address not configured');
    }

    // Must have 'wit' prefix
    if (!this.signerAddress.startsWith('wit')) {
      throw new OrderNotProcessableException(
        `Clementine signer address must have 'wit' prefix, got: ${this.signerAddress}`,
      );
    }

    // Underlying address must be valid
    const underlyingAddress = this.signerAddress.replace(/^wit/, '');
    if (!this.isValidBitcoinAddress(underlyingAddress)) {
      throw new OrderNotProcessableException(
        `Clementine signer address has invalid underlying Bitcoin address: ${underlyingAddress}`,
      );
    }

    this.logger.verbose(`Signer address validated: ${this.signerAddress}`);
  }

  //*** NETWORK VALIDATION ***//

  /**
   * Validates that all configured addresses and connected nodes match the expected network (mainnet/testnet).
   * Throws an error on first use if there's a network mismatch to prevent fund loss.
   * Only validates once, subsequent calls are skipped.
   */
  private async validateNetworkConsistency(): Promise<void> {
    if (this.networkValidated) return;

    const errors: string[] = [];

    // Validate CLI version
    if (!this.expectedCliVersion) {
      errors.push('CLEMENTINE_CLI_VERSION environment variable is not configured');
    } else {
      try {
        const versionInfo = await this.clementineClient.getVersion();
        this.logger.info(
          `Clementine CLI version: ${versionInfo.version}` +
            (versionInfo.commit ? ` (commit: ${versionInfo.commit})` : ''),
        );

        if (versionInfo.version !== this.expectedCliVersion) {
          errors.push(
            `Clementine CLI version mismatch: expected '${this.expectedCliVersion}', got '${versionInfo.version}'`,
          );
        }
      } catch (e) {
        errors.push(`Failed to verify Clementine CLI version: ${e.message}`);
      }
    }

    // Validate Bitcoin node is on correct network
    try {
      const btcInfo = await this.bitcoinClient.getInfo();
      const expectedChain = BTC_CHAIN_NAMES[this.network];
      if (btcInfo.chain !== expectedChain) {
        errors.push(
          `Bitcoin node is on '${btcInfo.chain}' but Clementine network is '${this.network}' (expected '${expectedChain}')`,
        );
      }
    } catch (e) {
      errors.push(`Failed to verify Bitcoin node network: ${e.message}`);
    }

    // Validate Citrea client is on correct network
    const expectedCitreaChainId = CITREA_CHAIN_IDS[this.network];
    if (this.citreaClient.chainId !== expectedCitreaChainId) {
      errors.push(
        `Citrea client chainId is ${this.citreaClient.chainId} but expected ${expectedCitreaChainId} for Clementine network '${this.network}'`,
      );
    }

    // Validate Bitcoin wallet address
    const btcWalletAddress = this.bitcoinClient.walletAddress;
    if (btcWalletAddress && !this.isAddressForNetwork(btcWalletAddress, this.network)) {
      errors.push(`Bitcoin wallet address '${btcWalletAddress}' does not match Clementine network '${this.network}'`);
    }

    // Validate recovery taproot address (dep-prefixed, but underlying address should match network)
    if (this.recoveryTaprootAddress) {
      const underlyingRecoveryAddress = this.recoveryTaprootAddress.replace(/^dep/, '');
      if (!this.isAddressForNetwork(underlyingRecoveryAddress, this.network)) {
        errors.push(
          `Recovery taproot address '${this.recoveryTaprootAddress}' does not match Clementine network '${this.network}'`,
        );
      }
    }

    // Validate signer address (wit-prefixed, but underlying address should match network)
    if (this.signerAddress) {
      const underlyingSignerAddress = this.signerAddress.replace(/^wit/, '');
      if (!this.isAddressForNetwork(underlyingSignerAddress, this.network)) {
        errors.push(`Signer address '${this.signerAddress}' does not match Clementine network '${this.network}'`);
      }
    }

    if (errors.length > 0) {
      const errorMsg = `Clementine network configuration mismatch:\n${errors.join('\n')}`;
      this.logger.error(errorMsg);
      throw new OrderNotProcessableException(errorMsg);
    }

    this.networkValidated = true;
    this.logger.info(`Clementine network validation passed for '${this.network}'`);
  }

  /**
   * Checks if a Bitcoin address matches the expected network based on its prefix.
   */
  private isAddressForNetwork(address: string, network: ClementineNetwork): boolean {
    const prefixes = BTC_ADDRESS_PREFIXES[network];
    return prefixes.some((prefix) => address.startsWith(prefix));
  }

  //*** NETWORK HELPERS ***//

  private get isTestnet(): boolean {
    return this.network === ClementineNetwork.TESTNET4;
  }

  private get btcBlockchain(): Blockchain {
    return this.isTestnet ? Blockchain.BITCOIN_TESTNET4 : Blockchain.BITCOIN;
  }

  private get citreaBlockchain(): Blockchain {
    return this.isTestnet ? Blockchain.CITREA_TESTNET : Blockchain.CITREA;
  }

  private getBtcAsset(): Promise<Asset> {
    return this.isTestnet ? this.assetService.getBitcoinTestnet4Coin() : this.assetService.getBtcCoin();
  }

  private getCitreaAsset(): Promise<Asset> {
    return this.isTestnet ? this.assetService.getCitreaTestnetCoin() : this.assetService.getCitreaCoin();
  }

  private getFeeRate(): Promise<number> {
    return this.isTestnet
      ? this.bitcoinTestnet4FeeService.getRecommendedFeeRate()
      : this.bitcoinFeeService.getRecommendedFeeRate();
  }
}
