import { spawn } from 'child_process';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export enum ClementineNetwork {
  BITCOIN = 'bitcoin',
  TESTNET4 = 'testnet4',
}

export interface ClementineConfig {
  network: ClementineNetwork;
  cliPath: string;
  timeoutMs: number;
  signingTimeoutMs: number;
}

export enum DepositStatus {
  PENDING = 'pending',
  CONFIRMING = 'confirming',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum WithdrawStatus {
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

    // Parse withdrawal UTXO from output (format: txid:vout)
    const utxoMatch = output.match(/([a-f0-9]{64}:\d+)/i);
    if (utxoMatch) {
      return { withdrawalUtxo: utxoMatch[1] };
    }

    // Check if no UTXO found
    if (output.toLowerCase().includes('no') || output.toLowerCase().includes('not found')) {
      return null;
    }

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

    // Parse both signatures from output
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
   */
  async withdrawSend(
    signerAddress: string,
    destinationAddress: string,
    withdrawalUtxo: string,
    optimisticSignature: string,
  ): Promise<void> {
    await this.executeCommand([
      'withdraw',
      'send-safe-withdraw',
      signerAddress,
      destinationAddress,
      withdrawalUtxo,
      optimisticSignature,
    ]);
  }

  /**
   * Get the status of a withdrawal operation
   * Command: clementine-cli withdraw status <WITHDRAWAL_UTXO>
   * @param withdrawalUtxo The withdrawal UTXO to check (format: txid:vout)
   */
  async withdrawStatus(withdrawalUtxo: string): Promise<WithdrawStatusResult> {
    const output = await this.executeCommand(['withdraw', 'status', withdrawalUtxo]);
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
    await this.executeCommand([
      'withdraw',
      'send-withdrawal-signature-to-operators',
      signerAddress,
      destinationAddress,
      withdrawalUtxo,
      operatorPaidSignature,
    ]);
  }

  // --- INTERNAL METHODS --- //

  private async executeCommand(args: string[], timeout?: number): Promise<string> {
    const fullArgs = this.buildArgs(args);
    this.logger.verbose(`Executing: ${this.config.cliPath} ${fullArgs.join(' ')}`);

    try {
      const output = await this.spawnAsync(fullArgs, timeout ?? this.config.timeoutMs);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Clementine CLI error: ${message}`);
      throw new Error(`Clementine CLI failed: ${message}`);
    }
  }

  private spawnAsync(args: string[], timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | null = null;
      let killTimeoutId: NodeJS.Timeout | null = null;
      let isSettled = false;

      const proc = spawn(this.config.cliPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const cleanup = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (killTimeoutId) {
          clearTimeout(killTimeoutId);
          killTimeoutId = null;
        }
      };

      const settle = (error?: Error, result?: string): void => {
        if (isSettled) return;
        isSettled = true;
        cleanup();

        if (error) {
          reject(error);
        } else {
          resolve(result ?? '');
        }
      };

      // Timeout handling
      timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');

        // Force kill after 5 seconds if process doesn't respond to SIGTERM
        killTimeoutId = setTimeout(() => {
          if (proc.exitCode === null) {
            // Process still running, force kill
            proc.kill('SIGKILL');
          }
        }, 5000);

        settle(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error: Error) => {
        settle(new Error(`Spawn error: ${error.message}`));
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          settle(undefined, stdout);
        } else {
          settle(new Error(`Exit code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }

  private buildArgs(baseArgs: string[]): string[] {
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
