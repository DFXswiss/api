import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EthereumClient } from 'src/integration/blockchain/ethereum/ethereum-client';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { CitreaClient } from 'src/integration/blockchain/citrea/citrea-client';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import LAYERZERO_OFT_ADAPTER_ABI from 'src/integration/blockchain/shared/evm/abi/layerzero-oft-adapter.abi.json';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
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

/**
 * LayerZero OFT Adapter contract addresses for bridging from Ethereum to Citrea
 */
const LAYERZERO_OFT_ADAPTERS: Record<string, { ethereum: string; citrea: string }> = {
  // USDC: Ethereum SourceOFTAdapter -> Citrea DestinationOUSDC
  USDC: {
    ethereum: '0xdaa289CC487Cf95Ba99Db62f791c7E2d2a4b868E',
    citrea: '0x41710804caB0974638E1504DB723D7bddec22e30',
  },
  // USDT: Ethereum SourceOFTAdapter -> Citrea DestinationOUSDT
  USDT: {
    ethereum: '0x6925ccD29e3993c82a574CED4372d8737C6dbba6',
    citrea: '0xF8b5983BFa11dc763184c96065D508AE1502C030',
  },
  // WBTC: Ethereum WBTCOFTAdapter -> Citrea WBTCOFT
  WBTC: {
    ethereum: '0x2c01390E10e44C968B73A7BcFF7E4b4F50ba76Ed',
    citrea: '0xDF240DC08B0FdaD1d93b74d5048871232f6BEA3d',
  },
};

// Citrea LayerZero Endpoint ID
const CITREA_LZ_ENDPOINT_ID = 30291;

enum LayerZeroBridgeCommands {
  DEPOSIT = 'deposit', // Ethereum -> Citrea
}

@Injectable()
export class LayerZeroBridgeAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(LayerZeroBridgeAdapter);

  protected commands = new Map<string, Command>();

  private readonly ethereumClient: EthereumClient;
  private readonly citreaClient: CitreaClient;

  constructor(
    private readonly ethereumService: EthereumService,
    private readonly citreaService: CitreaService,
    private readonly assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.LAYERZERO_BRIDGE);

    this.ethereumClient = ethereumService.getDefaultClient<EthereumClient>();
    this.citreaClient = citreaService.getDefaultClient<CitreaClient>();

    this.commands.set(LayerZeroBridgeCommands.DEPOSIT, this.deposit.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { target: asset },
      },
      outputAmount,
    } = order;

    if (!isAsset(asset)) {
      throw new Error('LayerZeroBridgeAdapter.checkCompletion(...) supports only Asset instances as an input.');
    }

    try {
      // Step 1: Verify the Ethereum transaction succeeded
      // The correlationId contains the Ethereum TX hash
      const txReceipt = await this.ethereumClient.getTxReceipt(order.correlationId);

      if (!txReceipt) {
        this.logger.verbose(`LayerZero TX not found: ${order.correlationId}`);
        return false;
      }

      if (txReceipt.status !== 1) {
        this.logger.warn(`LayerZero TX failed on Ethereum: ${order.correlationId}`);
        return false;
      }

      // Step 2: Check if the tokens have arrived on Citrea
      // Note: LayerZero message finality typically takes 2-5 minutes
      // A more robust solution would use LayerZero Scan API to track the message GUID
      const citreaBalance = await this.citreaClient.getTokenBalance(asset);

      // Verify we have at least the expected output amount on Citrea
      // This is a heuristic check - if wallet had pre-existing balance, this may return true early
      const hasExpectedBalance = citreaBalance >= (outputAmount ?? 0);

      if (hasExpectedBalance) {
        this.logger.info(
          `LayerZero bridge complete: ${order.correlationId}, balance: ${citreaBalance} ${asset.name}`,
        );
      }

      return hasExpectedBalance;
    } catch (e) {
      this.logger.warn(`LayerZero checkCompletion failed for ${order.correlationId}: ${e.message}`);
      return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    // LayerZero bridge doesn't require additional params
    return command === LayerZeroBridgeCommands.DEPOSIT && (!params || Object.keys(params).length === 0);
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  /**
   * Deposit tokens from Ethereum to Citrea via LayerZero
   */
  private async deposit(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset: citreaAsset },
      },
      minAmount,
      maxAmount,
    } = order;

    // Only support tokens, not native coins
    if (citreaAsset.type !== AssetType.TOKEN) {
      throw new OrderNotProcessableException('LayerZero bridge only supports TOKEN type assets');
    }

    // Get the base token name (e.g., "USDC.e" -> "USDC", "USDT.e" -> "USDT")
    const baseTokenName = this.getBaseTokenName(citreaAsset.name);

    // Get OFT adapter addresses
    const oftAdapter = LAYERZERO_OFT_ADAPTERS[baseTokenName];
    if (!oftAdapter) {
      throw new OrderNotProcessableException(
        `LayerZero bridge not configured for token: ${citreaAsset.name} (base: ${baseTokenName})`,
      );
    }

    // Find the corresponding Ethereum asset
    const ethereumAsset = await this.assetService.getAssetByQuery({
      name: baseTokenName,
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });

    if (!ethereumAsset) {
      throw new OrderNotProcessableException(`Could not find Ethereum asset for ${baseTokenName}`);
    }

    // Check Ethereum balance
    const ethereumBalance = await this.ethereumClient.getTokenBalance(ethereumAsset);
    if (ethereumBalance < minAmount) {
      throw new OrderNotProcessableException(
        `Not enough ${baseTokenName} on Ethereum (balance: ${ethereumBalance}, min: ${minAmount})`,
      );
    }

    const amount = Math.min(maxAmount, ethereumBalance);
    const amountWei = EvmUtil.toWeiAmount(amount, ethereumAsset.decimals);

    // Set order amounts
    order.inputAmount = amount;
    order.inputAsset = ethereumAsset.name;
    order.outputAmount = amount;
    order.outputAsset = citreaAsset.name;

    this.logger.info(
      `LayerZero bridge: ${amount} ${baseTokenName} from Ethereum to Citrea (adapter: ${oftAdapter.ethereum})`,
    );

    // Execute the bridge transaction
    return this.executeBridge(ethereumAsset, oftAdapter.ethereum, amountWei);
  }

  /**
   * Execute the LayerZero bridge transaction
   */
  private async executeBridge(
    ethereumAsset: Asset,
    oftAdapterAddress: string,
    amountWei: ethers.BigNumber,
  ): Promise<string> {
    const wallet = this.ethereumClient.wallet;
    const recipientAddress = this.citreaClient.walletAddress;

    // Create OFT adapter contract instance
    const oftAdapter = new ethers.Contract(oftAdapterAddress, LAYERZERO_OFT_ADAPTER_ABI, wallet);

    // Check if approval is required
    const approvalRequired = await oftAdapter.approvalRequired();
    if (approvalRequired) {
      // Approve the OFT adapter to spend tokens
      const tokenContract = new ethers.Contract(ethereumAsset.chainId, ERC20_ABI, wallet);
      const currentAllowance = await tokenContract.allowance(wallet.address, oftAdapterAddress);

      if (currentAllowance.lt(amountWei)) {
        this.logger.info(`Approving ${oftAdapterAddress} to spend ${ethereumAsset.name}`);
        const approveTx = await tokenContract.approve(oftAdapterAddress, ethers.constants.MaxUint256);
        await approveTx.wait();
      }
    }

    // Prepare send parameters
    // Convert recipient address to bytes32 format (left-padded with zeros)
    const recipientBytes32 = ethers.utils.hexZeroPad(recipientAddress, 32);

    const sendParam = {
      dstEid: CITREA_LZ_ENDPOINT_ID,
      to: recipientBytes32,
      amountLD: amountWei,
      minAmountLD: amountWei.mul(99).div(100), // 1% slippage tolerance
      extraOptions: '0x', // No extra options
      composeMsg: '0x', // No compose message
      oftCmd: '0x', // No OFT command
    };

    // Get quote for LayerZero fees
    const messagingFee = await oftAdapter.quoteSend(sendParam, false);
    const nativeFee = messagingFee.nativeFee;

    this.logger.info(`LayerZero fee: ${EvmUtil.fromWeiAmount(nativeFee.toString())} ETH`);

    // Execute the send transaction
    const sendTx = await oftAdapter.send(sendParam, { nativeFee, lzTokenFee: 0 }, wallet.address, {
      value: nativeFee,
      gasLimit: 500000, // Set a reasonable gas limit
    });

    this.logger.info(`LayerZero bridge TX submitted: ${sendTx.hash}`);

    // Wait for confirmation
    const receipt = await sendTx.wait();

    if (receipt.status !== 1) {
      throw new OrderFailedException('LayerZero bridge transaction failed');
    }

    return sendTx.hash;
  }

  /**
   * Extract base token name from bridged token name
   * e.g., "USDC.e" -> "USDC", "USDT.e" -> "USDT", "WBTC.e" -> "WBTC"
   */
  private getBaseTokenName(tokenName: string): string {
    // Remove common bridge suffixes
    return tokenName.replace(/\.e$/i, '').replace(/\.b$/i, '');
  }
}
