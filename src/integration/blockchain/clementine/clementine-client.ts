import * as pty from 'node-pty';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export enum ClementineNetwork {
  BITCOIN = 'bitcoin',
  TESTNET4 = 'testnet4',
}

export interface ClementineConfig {
  network: ClementineNetwork;
  cliPath: string;
  homeDir: string;
  timeoutMs: number;
  signingTimeoutMs: number;
  expectedVersion: string;
  passphrase: string;
}

export interface ClementineVersionInfo {
  version: string;
  commit?: string;
  rawOutput: string;
}

export enum DepositStatus {
  PENDING = 'pending',
  CONFIRMING = 'confirming',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum WithdrawStatus {
  NOT_FOUND = 'not_found',
  PENDING = 'pending',
  SCANNING = 'scanning',
  SIGNING = 'signing',
  BROADCASTING = 'broadcasting',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface DepositStartResult {
  depositAddress: string;
}

export interface DepositStatusResult {
  status: DepositStatus;
  depositAddress: string;
  btcTxId?: string;
  errorMessage?: string;
}

export interface WithdrawStartResult {
  signerAddress: string;
}

export interface WithdrawScanResult {
  withdrawalUtxo: string;
}

export interface WithdrawSignaturesResult {
  optimisticSignature: string;
  operatorPaidSignature: string;
}

export interface WithdrawStatusResult {
  status: WithdrawStatus;
  withdrawalUtxo: string;
  btcTxId?: string;
  errorMessage?: string;
}

// Fixed bridge amount as per Clementine/BitVM design
export const CLEMENTINE_BRIDGE_AMOUNT_BTC = 10;

// Dust amount required to create withdrawal UTXO (330 satoshis)
export const CLEMENTINE_WITHDRAWAL_DUST_BTC = 0.0000033;

export class ClementineClient {
  private readonly logger = new DfxLogger(ClementineClient);

  constructor(private readonly config: ClementineConfig) {}

  // --- INITIALIZATION --- //

  /**
   * Initialize the CLI configuration
   * Creates ~/.clementine/bridge_cli_config.toml
   */
  async init(): Promise<void> {
    await this.executeCommand(['init']);
  }

  /**
   * Get the current CLI configuration
   */
  async showConfig(): Promise<string> {
    return this.executeCommand(['show-config']);
  }

  /**
   * Get the CLI version information
   * @returns Version info including semver version and optional commit hash
   */
  async getVersion(): Promise<ClementineVersionInfo> {
    const output = await this.executeCommand(['--version'], undefined, false);

    // Try to parse semver version (e.g., "1.2.3", "v1.2.3", "clementine-cli 1.2.3")
    const versionMatch = output.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);

    // Try to parse commit hash (e.g., "commit: abc123", "git: abc123def")
    const commitMatch = output.match(/(?:commit|git)[:\s]+([a-f0-9]{7,40})/i);

    return {
      version: versionMatch?.[1] ?? 'unknown',
      commit: commitMatch?.[1],
      rawOutput: output.trim(),
    };
  }

  // --- WALLET OPERATIONS --- //

  /**
   * Create a new wallet
   * @param name Wallet name
   * @param type Wallet type: 'deposit' or 'withdrawal'
   */
  async walletCreate(name: string, type: 'deposit' | 'withdrawal'): Promise<void> {
    await this.executeCommand(['wallet', 'create', name, type]);
  }

  // --- DEPOSIT OPERATIONS --- //

  /**
   * Start a deposit operation (BTC -> cBTC)
   * Command: clementine-cli deposit start <RECOVERY_TAPROOT_ADDRESS> <CITREA_ADDRESS>
   * @param recoveryTaprootAddress Recovery address for failed deposits (dep-prefixed)
   * @param citreaAddress Destination address on Citrea for cBTC
   * @returns The deposit address to send 10 BTC to
   */
  async depositStart(recoveryTaprootAddress: string, citreaAddress: string): Promise<DepositStartResult> {
    const output = await this.executeCommand(['deposit', 'start', recoveryTaprootAddress, citreaAddress]);

    // Parse the deposit address from CLI output
    const addressMatch =
      output.match(/(?:deposit\s+)?address[:\s]+([a-zA-Z0-9]+)/i) ||
      output.match(/bc1[a-zA-Z0-9]{59,}/i) ||
      output.match(/tb1[a-zA-Z0-9]{59,}/i);
    if (!addressMatch) {
      throw new Error(`Failed to parse deposit address from CLI output: ${output}`);
    }

    return { depositAddress: addressMatch[1] || addressMatch[0] };
  }

  /**
   * Get the status of a deposit operation
   * Command: clementine-cli deposit status <DEPOSIT_ADDRESS>
   * @param depositAddress The deposit address to check
   */
  async depositStatus(depositAddress: string): Promise<DepositStatusResult> {
    const output = await this.executeCommand(['deposit', 'status', depositAddress]);
    return this.parseDepositStatus(output, depositAddress);
  }

  /**
   * Create a signed recovery transaction (for airgapped device usage)
   * Command: clementine-cli deposit create-signed-recovery-tx <RECOVERY_TAPROOT_ADDRESS> <CITREA_ADDRESS> <DEPOSIT_UTXO_OUTPOINT> <DESTINATION_ADDRESS> <FEE_RATE> <AMOUNT> <CLEMENTINE_AGGREGATED_KEY>
   * @param recoveryTaprootAddress Recovery address (dep-prefixed)
   * @param citreaAddress Citrea address used in deposit
   * @param depositUtxoOutpoint Deposit UTXO (format: txid:vout)
   * @param destinationAddress Bitcoin destination for recovered funds
   * @param feeRate Fee rate in sat/vB
   * @param amount Amount in BTC
   * @param clementineAggregatedKey Aggregated public key from bridge
   */
  async depositCreateSignedRecoveryTx(
    recoveryTaprootAddress: string,
    citreaAddress: string,
    depositUtxoOutpoint: string,
    destinationAddress: string,
    feeRate: number,
    amount: number,
    clementineAggregatedKey: string,
  ): Promise<string> {
    return this.executeCommand(
      [
        'deposit',
        'create-signed-recovery-tx',
        recoveryTaprootAddress,
        citreaAddress,
        depositUtxoOutpoint,
        destinationAddress,
        feeRate.toString(),
        amount.toString(),
        clementineAggregatedKey,
      ],
      this.config.signingTimeoutMs,
    );
  }

  // --- WITHDRAWAL OPERATIONS --- //

  /**
   * Start a withdrawal operation (cBTC -> BTC)
   * Command: clementine-cli withdraw start <SIGNER_ADDRESS> <DESTINATION_ADDRESS>
   * Note: After this, user must send 330 satoshis to the signer address
   * @param signerAddress Signer address (wit-prefixed) for the withdrawal
   * @param destinationAddress Bitcoin destination address for the withdrawal
   * @returns The signer address (user must send 330 sats to this)
   */
  async withdrawStart(signerAddress: string, destinationAddress: string): Promise<WithdrawStartResult> {
    await this.executeCommand(['withdraw', 'start', signerAddress, destinationAddress]);
    return { signerAddress };
  }

  /**
   * Scan for available withdrawal UTXOs
   * Command: clementine-cli withdraw scan <SIGNER_ADDRESS> <DESTINATION_ADDRESS>
   * @param signerAddress Signer address (wit-prefixed)
   * @param destinationAddress Bitcoin destination address
   * @returns The withdrawal UTXO if found
   */
  async withdrawScan(signerAddress: string, destinationAddress: string): Promise<WithdrawScanResult | null> {
    const output = await this.executeCommand(['withdraw', 'scan', signerAddress, destinationAddress]);

    if (output.toLowerCase().includes('waiting for confirmation') || output.toLowerCase().includes('unconfirmed')) {
      this.logger.verbose('withdrawScan: UTXO found but unconfirmed, waiting for confirmation');
      return null;
    }

    // Parse withdrawal UTXO from output (format: txid:vout)
    const utxoMatch = output.match(/([a-f0-9]{64}:\d+)/i);
    if (utxoMatch) {
      return { withdrawalUtxo: utxoMatch[1] };
    }

    // Check if no UTXO found
    if (output.toLowerCase().includes('no') || output.toLowerCase().includes('not found')) {
      return null;
    }

    // Unknown output format - log warning and return null
    this.logger.warn(`withdrawScan: unexpected CLI output format, treating as no UTXO found. Output: ${output}`);

    return null;
  }

  /**
   * Generate withdrawal signatures
   * Command: clementine-cli withdraw generate-withdrawal-signatures <SIGNER_ADDRESS> <DESTINATION_ADDRESS> <WITHDRAWAL_UTXO>
   * @param signerAddress Signer address (wit-prefixed)
   * @param destinationAddress Bitcoin destination address
   * @param withdrawalUtxo The withdrawal UTXO (format: txid:vout)
   * @returns Two signatures: optimistic (9.9999976 BTC) and operator-paid (9.97 BTC)
   */
  async withdrawGenerateSignatures(
    signerAddress: string,
    destinationAddress: string,
    withdrawalUtxo: string,
  ): Promise<WithdrawSignaturesResult> {
    const output = await this.executeCommand(
      ['withdraw', 'generate-withdrawal-signatures', signerAddress, destinationAddress, withdrawalUtxo],
      this.config.signingTimeoutMs,
    );

    // Try to parse signatures by their labels first (safer)
    // CLI output format: "Optimistic withdrawal signature hex: {sig}" and "Operator-paid withdrawal signature hex: {sig}"
    const optimisticMatch = output.match(/optimistic[^:]*signature[^:]*:\s*([a-f0-9]+)/i);
    const operatorMatch = output.match(/operator[^:]*signature[^:]*:\s*([a-f0-9]+)/i);

    if (optimisticMatch && operatorMatch) {
      return {
        optimisticSignature: optimisticMatch[1],
        operatorPaidSignature: operatorMatch[1],
      };
    }

    // Fallback: parse by order (less safe - assumes first is optimistic, second is operator)
    this.logger.warn(
      'Could not find labeled signatures in CLI output, falling back to order-based parsing. ' +
        'This may cause issues if CLI output format changes.',
    );

    const sigMatches = output.match(/signature[:\s]+([a-f0-9]+)/gi);
    if (!sigMatches || sigMatches.length < 2) {
      throw new Error(`Failed to parse withdrawal signatures from CLI output: ${output}`);
    }

    const extractSig = (match: string) => match.replace(/signature[:\s]+/i, '');

    return {
      optimisticSignature: extractSig(sigMatches[0]),
      operatorPaidSignature: extractSig(sigMatches[1]),
    };
  }

  /**
   * Send withdrawal request to bridge contract (burns cBTC)
   * Command: clementine-cli withdraw send-safe-withdraw <SIGNER_ADDRESS> <DESTINATION_ADDRESS> <WITHDRAWAL_UTXO> <OPTIMISTIC_SIGNATURE>
   * Note: Uses send-safe-withdraw (non-interactive) instead of send (opens browser)
   * @param signerAddress Signer address (wit-prefixed)
   * @param destinationAddress Bitcoin destination address
   * @param withdrawalUtxo The withdrawal UTXO (format: txid:vout)
   * @param optimisticSignature The optimistic withdrawal signature
   * @param citreaPrivateKey Citrea private key for signing the withdrawal transaction (64 hex chars)
   */
  async withdrawSend(
    signerAddress: string,
    destinationAddress: string,
    withdrawalUtxo: string,
    optimisticSignature: string,
    citreaPrivateKey: string,
  ): Promise<void> {
    await this.executeCommand(
      ['withdraw', 'send-safe-withdraw', signerAddress, destinationAddress, withdrawalUtxo, optimisticSignature],
      this.config.signingTimeoutMs,
      true,
      citreaPrivateKey,
    );
  }

  /**
   * Get the status of a withdrawal operation
   * Command: clementine-cli withdraw status <WITHDRAWAL_UTXO>
   * @param withdrawalUtxo The withdrawal UTXO to check (format: txid:vout)
   * @returns Status result with NOT_FOUND if no withdrawal exists for this UTXO
   */
  async withdrawStatus(withdrawalUtxo: string): Promise<WithdrawStatusResult> {
    const output = await this.executeCommand(['withdraw', 'status', withdrawalUtxo]);

    // Check if no withdrawal exists for this UTXO
    // CLI outputs "No withdrawals found for OutPoint ..." if never submitted
    if (output.toLowerCase().includes('no withdrawals found')) {
      return {
        withdrawalUtxo,
        status: WithdrawStatus.NOT_FOUND,
      };
    }

    return this.parseWithdrawStatus(output, withdrawalUtxo);
  }

  /**
   * Send operator-paid withdrawal signature (fallback after 12 hours)
   * Command: clementine-cli withdraw send-withdrawal-signature-to-operators <SIGNER_ADDRESS> <DESTINATION_ADDRESS> <WITHDRAWAL_UTXO> <OPERATOR_PAID_SIGNATURE>
   * @param signerAddress Signer address (wit-prefixed)
   * @param destinationAddress Bitcoin destination address
   * @param withdrawalUtxo The withdrawal UTXO (format: txid:vout)
   * @param operatorPaidSignature The operator-paid withdrawal signature
   */
  async withdrawSendToOperators(
    signerAddress: string,
    destinationAddress: string,
    withdrawalUtxo: string,
    operatorPaidSignature: string,
  ): Promise<void> {
    await this.executeCommand(
      [
        'withdraw',
        'send-withdrawal-signature-to-operators',
        signerAddress,
        destinationAddress,
        withdrawalUtxo,
        operatorPaidSignature,
      ],
      this.config.signingTimeoutMs,
    );
  }

  // --- INTERNAL METHODS --- //

  private async executeCommand(
    args: string[],
    timeout?: number,
    addNetworkFlag = true,
    citreaPrivateKey?: string,
  ): Promise<string> {
    const finalArgs = addNetworkFlag ? this.addNetworkFlag(args) : args;

    try {
      return await this.spawnWithPty(finalArgs, timeout ?? this.config.timeoutMs, citreaPrivateKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Clementine CLI error: ${message}`);
      throw new Error(`Clementine CLI failed: ${message}`);
    }
  }

  /**
   * Spawn CLI with PTY to handle interactive prompts.
   * @param args CLI arguments
   * @param timeout Timeout in milliseconds
   * @param citreaPrivateKey Optional Citrea private key for signing withdrawals (64 hex chars)
   */
  private spawnWithPty(args: string[], timeout: number, citreaPrivateKey?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let timeoutId: NodeJS.Timeout | null = null;
      let isSettled = false;
      let passphraseHandled = false;
      let citreaKeyHandled = false;

      this.logger.verbose(`Executing (PTY): ${this.config.cliPath} ${args.join(' ')}`);

      const proc = pty.spawn(this.config.cliPath, args, {
        name: 'xterm',
        cols: 200,
        rows: 30,
        env: { ...process.env, HOME: this.config.homeDir } as Record<string, string>,
      });

      const cleanup = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const settle = (error?: Error, result?: string): void => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        proc.kill();

        if (error) {
          reject(error);
        } else {
          resolve(result ?? '');
        }
      };

      timeoutId = setTimeout(() => {
        settle(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      proc.onData((data: string) => {
        output += data;
        const lowerData = data.toLowerCase();

        if (!passphraseHandled && lowerData.includes('passphrase')) {
          passphraseHandled = true;
          proc.write(this.config.passphrase + '\r');
        }

        if (!citreaKeyHandled && lowerData.includes('secret key')) {
          citreaKeyHandled = true;
          if (citreaPrivateKey) {
            proc.write(citreaPrivateKey + '\r');
          } else {
            settle(new Error('CLI prompted for Citrea private key but none was provided'));
          }
        }
      });

      proc.onExit(({ exitCode }) => {
        if (exitCode === 0) {
          settle(undefined, output);
        } else {
          settle(new Error(`Exit code ${exitCode}: ${output}`));
        }
      });
    });
  }

  private addNetworkFlag(baseArgs: string[]): string[] {
    const args = [...baseArgs];

    // Insert --network flag after the subcommand, before positional arguments
    // For commands with subcommand (e.g., 'deposit start'): insert at position 2
    // For single commands (e.g., 'show-config'): insert at position 1
    const insertPosition = baseArgs.length >= 2 ? 2 : 1;
    args.splice(insertPosition, 0, '--network', this.config.network);

    return args;
  }

  private parseDepositStatus(output: string, depositAddress: string): DepositStatusResult {
    const lowerOutput = output.toLowerCase();

    let status: DepositStatus = DepositStatus.PENDING;
    if (lowerOutput.includes('completed') || lowerOutput.includes('success') || lowerOutput.includes('minted')) {
      status = DepositStatus.COMPLETED;
    } else if (
      lowerOutput.includes('confirming') ||
      lowerOutput.includes('waiting') ||
      lowerOutput.includes('confirmation')
    ) {
      status = DepositStatus.CONFIRMING;
    } else if (lowerOutput.includes('failed') || lowerOutput.includes('error')) {
      status = DepositStatus.FAILED;
    }

    // Try to parse BTC transaction ID
    const txMatch = output.match(/txid[:\s]+([a-f0-9]{64})/i) || output.match(/transaction[:\s]+([a-f0-9]{64})/i);
    const btcTxId = txMatch ? txMatch[1] : undefined;

    // Try to parse error message
    const errorMatch = output.match(/error[:\s]+(.+)/i);
    const errorMessage = status === DepositStatus.FAILED ? errorMatch?.[1]?.trim() : undefined;

    return {
      depositAddress,
      status,
      btcTxId,
      errorMessage,
    };
  }

  private parseWithdrawStatus(output: string, withdrawalUtxo: string): WithdrawStatusResult {
    const lowerOutput = output.toLowerCase();

    let status: WithdrawStatus = WithdrawStatus.PENDING;
    if (lowerOutput.includes('completed') || lowerOutput.includes('success')) {
      status = WithdrawStatus.COMPLETED;
    } else if (lowerOutput.includes('broadcasting') || lowerOutput.includes('broadcast')) {
      status = WithdrawStatus.BROADCASTING;
    } else if (lowerOutput.includes('signing') || lowerOutput.includes('signature')) {
      status = WithdrawStatus.SIGNING;
    } else if (lowerOutput.includes('scanning') || lowerOutput.includes('scan')) {
      status = WithdrawStatus.SCANNING;
    } else if (lowerOutput.includes('failed') || lowerOutput.includes('error')) {
      status = WithdrawStatus.FAILED;
    }

    // Try to parse BTC transaction ID
    const txMatch = output.match(/txid[:\s]+([a-f0-9]{64})/i) || output.match(/transaction[:\s]+([a-f0-9]{64})/i);
    const btcTxId = txMatch ? txMatch[1] : undefined;

    // Try to parse error message
    const errorMatch = output.match(/error[:\s]+(.+)/i);
    const errorMessage = status === WithdrawStatus.FAILED ? errorMatch?.[1]?.trim() : undefined;

    return {
      withdrawalUtxo,
      status,
      btcTxId,
      errorMessage,
    };
  }
}
