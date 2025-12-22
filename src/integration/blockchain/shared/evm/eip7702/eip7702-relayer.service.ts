import { Injectable } from '@nestjs/common';
import { Contract, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmUtil } from '../evm.util';
import DFX_GASLESS_SELL_ABI from '../abi/dfx-gasless-sell.abi.json';
import {
  Eip712TypedData,
  GaslessTransferPrepareRequest,
  GaslessTransferPrepareResponse,
  GaslessTransferRequest,
  GaslessTransferResult,
} from './dto/gasless-transfer.dto';

const DEFAULT_DEADLINE_MINUTES = 60;

@Injectable()
export class Eip7702RelayerService {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly relayerWallet: ethers.Wallet;
  private readonly chainId: number;
  private readonly delegationContractAddress: string;
  private readonly allowedRecipients: Set<string>;

  constructor(
    private readonly http: HttpService,
    private readonly alchemyService: AlchemyService,
  ) {
    const config = GetConfig().blockchain.ethereum;
    const url = `${config.ethGatewayUrl}/${config.ethApiKey ?? ''}`;

    this.provider = new ethers.providers.JsonRpcProvider(url);
    this.relayerWallet = new ethers.Wallet(config.ethWalletPrivateKey, this.provider);
    this.chainId = config.ethChainId;

    // TODO: Add to config
    this.delegationContractAddress = process.env.EIP7702_DELEGATION_CONTRACT ?? '';
    this.allowedRecipients = new Set(
      (process.env.EIP7702_ALLOWED_RECIPIENTS ?? '').toLowerCase().split(',').filter(Boolean),
    );
  }

  // --- Prepare Transfer (for user to sign) ---

  async prepareGaslessTransfer(request: GaslessTransferPrepareRequest): Promise<GaslessTransferPrepareResponse> {
    const { userAddress, tokenAddress, amount, recipient, deadlineMinutes } = request;

    // Validate recipient is a DFX-controlled address
    this.validateRecipient(recipient);

    // Get current nonce from user's delegated contract
    const nonce = await this.getUserNonce(userAddress);

    // Calculate deadline
    const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes ?? DEFAULT_DEADLINE_MINUTES) * 60;

    // Build EIP-712 typed data
    const eip712Data = this.buildEip712TypedData(userAddress, tokenAddress, amount, recipient, nonce, deadline);

    return {
      nonce,
      deadline,
      delegationContract: this.delegationContractAddress,
      eip712Data,
    };
  }

  // --- Execute Transfer (with user's signature) ---

  async executeGaslessTransfer(request: GaslessTransferRequest): Promise<GaslessTransferResult> {
    const { userAddress, tokenAddress, amount, recipient, deadline, signature } = request;

    try {
      // Validate recipient is a DFX-controlled address
      this.validateRecipient(recipient);

      // Validate deadline hasn't passed
      if (Math.floor(Date.now() / 1000) > deadline) {
        return { success: false, error: 'Deadline has passed' };
      }

      // Create contract instance pointing to user's EOA (with EIP-7702 delegation)
      const userContract = new Contract(userAddress, DFX_GASLESS_SELL_ABI, this.relayerWallet);

      // Get gas price
      const gasPrice = await this.provider.getGasPrice();

      // Execute the transfer
      const tx = await userContract.executeTransfer(
        tokenAddress,
        amount,
        recipient,
        deadline,
        signature.v,
        signature.r,
        signature.s,
        {
          gasPrice: gasPrice.mul(120).div(100), // 20% buffer
        },
      );

      // Wait for transaction confirmation
      const receipt = await tx.wait(1);

      return {
        success: receipt.status === 1,
        txHash: receipt.transactionHash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  // --- View Functions ---

  async getUserNonce(userAddress: string): Promise<number> {
    try {
      const userContract = new Contract(userAddress, DFX_GASLESS_SELL_ABI, this.provider);
      const nonce = await userContract.nonce();
      return nonce.toNumber();
    } catch {
      // If contract not deployed (no EIP-7702 delegation yet), nonce is 0
      return 0;
    }
  }

  async getTransferHash(
    userAddress: string,
    tokenAddress: string,
    amount: string,
    recipient: string,
    deadline: number,
  ): Promise<string> {
    const userContract = new Contract(userAddress, DFX_GASLESS_SELL_ABI, this.provider);
    return userContract.getTransferHash(tokenAddress, amount, recipient, deadline);
  }

  async getDomainSeparator(userAddress: string): Promise<string> {
    const userContract = new Contract(userAddress, DFX_GASLESS_SELL_ABI, this.provider);
    return userContract.DOMAIN_SEPARATOR();
  }

  // --- Validation ---

  validateRecipient(recipient: string): void {
    if (!this.allowedRecipients.has(recipient.toLowerCase())) {
      throw new Error(`Recipient ${recipient} is not in the allowed list`);
    }
  }

  isRecipientAllowed(recipient: string): boolean {
    return this.allowedRecipients.has(recipient.toLowerCase());
  }

  // --- EIP-712 Helpers ---

  private buildEip712TypedData(
    verifyingContract: string,
    token: string,
    amount: string,
    recipient: string,
    nonce: number,
    deadline: number,
  ): Eip712TypedData {
    return {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Transfer: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Transfer',
      domain: {
        name: 'DfxGaslessSell',
        version: '1',
        chainId: this.chainId,
        verifyingContract,
      },
      message: {
        token,
        amount,
        recipient,
        nonce,
        deadline,
      },
    };
  }

  // --- Getters ---

  getDelegationContractAddress(): string {
    return this.delegationContractAddress;
  }

  getChainId(): number {
    return this.chainId;
  }
}
