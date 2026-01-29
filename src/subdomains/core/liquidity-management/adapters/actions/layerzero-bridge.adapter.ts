import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { CitreaClient } from 'src/integration/blockchain/citrea/citrea-client';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import { EthereumClient } from 'src/integration/blockchain/ethereum/ethereum-client';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import LAYERZERO_OFT_ADAPTER_ABI from 'src/integration/blockchain/shared/evm/abi/layerzero-oft-adapter.abi.json';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { isAsset } from 'src/shared/models/active';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
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

export enum LayerZeroBridgeCommands {
  DEPOSIT = 'deposit', // Ethereum -> Citrea
}

@Injectable()
export class LayerZeroBridgeAdapter extends LiquidityActionAdapter {
  protected commands = new Map<string, Command>();

  private readonly ethereumClient: EthereumClient;
  private readonly citreaClient: CitreaClient;

  constructor(
    ethereumService: EthereumService,
    citreaService: CitreaService,
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
    } = order;

    if (!isAsset(asset)) {
      throw new Error('LayerZeroBridgeAdapter.checkCompletion(...) supports only Asset instances as an input.');
    }

    try {
      // Step 1: Verify the Ethereum transaction succeeded
      const txReceipt = await this.ethereumClient.getTxReceipt(order.correlationId);

      if (!txReceipt) {
        return false;
      }

      if (txReceipt.status !== 1) {
        throw new OrderFailedException(`LayerZero TX failed on Ethereum: ${order.correlationId}`);
      }

      // Step 2: Search for incoming token transfer on Citrea from the OFT contract
      const baseTokenName = this.getBaseTokenName(asset.name);
      const oftAdapter = LAYERZERO_OFT_ADAPTERS[baseTokenName];
      if (!oftAdapter) {
        throw new OrderFailedException(`LayerZero OFT adapter not found for ${asset.name}`);
      }

      const currentBlock = await this.citreaClient.getCurrentBlock();
      const blocksPerDay = (24 * 3600) / 2; // ~2 second block time on Citrea
      const fromBlock = Math.max(0, currentBlock - blocksPerDay);

      const transfers = await this.citreaClient.getERC20Transactions(this.citreaClient.walletAddress, fromBlock);

      // Find transfer from the Citrea OFT contract matching the expected amount (with 5% tolerance)
      const expectedAmount = order.inputAmount;
      const matchingTransfer = transfers.find((t) => {
        const receivedAmount = EvmUtil.fromWeiAmount(t.value, asset.decimals);
        return (
          t.contractAddress?.toLowerCase() === asset.chainId.toLowerCase() &&
          t.from?.toLowerCase() === oftAdapter.citrea.toLowerCase() &&
          Math.abs(receivedAmount - expectedAmount) / expectedAmount < 0.05
        );
      });

      if (matchingTransfer) {
        order.outputAmount = EvmUtil.fromWeiAmount(matchingTransfer.value, asset.decimals);
        return true;
      }

      return false;
    } catch (e) {
      throw e instanceof OrderFailedException ? e : new OrderFailedException(e.message);
    }
  }

  validateParams(_command: string, _params: Record<string, unknown>): boolean {
    // LayerZero bridge doesn't require additional params
    return true;
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

    // Find adapter address
    const baseTokenName = this.getBaseTokenName(citreaAsset.name);
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
        `Not enough ${baseTokenName} on Ethereum (balance: ${ethereumBalance}, min. requested: ${minAmount}, max. requested: ${maxAmount})`,
      );
    }

    const amount = Math.min(maxAmount, ethereumBalance);
    const amountWei = EvmUtil.toWeiAmount(amount, ethereumAsset.decimals);

    // Update order
    order.inputAmount = amount;
    order.inputAsset = ethereumAsset.name;
    order.outputAsset = citreaAsset.name;

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

    // Check if approval is required and handle it
    await this.ensureTokenApproval(ethereumAsset, oftAdapterAddress, amountWei, oftAdapter);

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
    const nativeFeeEth = EvmUtil.fromWeiAmount(nativeFee.toString());

    // Verify sufficient ETH balance for LayerZero fee + gas
    const ethBalance = await this.ethereumClient.getNativeCoinBalance();
    const estimatedGasCost = 0.05; // Conservative estimate for gas costs
    const requiredEth = nativeFeeEth + estimatedGasCost;

    if (ethBalance < requiredEth) {
      throw new OrderNotProcessableException(
        `Insufficient ETH for LayerZero fee (balance: ${ethBalance} ETH, required: ~${requiredEth} ETH)`,
      );
    }

    // Execute the send transaction
    const sendTx = await oftAdapter.send(sendParam, { nativeFee, lzTokenFee: 0 }, wallet.address, {
      value: nativeFee,
      gasLimit: 500000, // Set a reasonable gas limit for OFT transfers
    });

    return sendTx.hash;
  }

  /**
   * Ensure token approval for the OFT adapter
   */
  private async ensureTokenApproval(
    ethereumAsset: Asset,
    oftAdapterAddress: string,
    amountWei: ethers.BigNumber,
    oftAdapter: ethers.Contract,
  ): Promise<void> {
    const approvalRequired = await oftAdapter.approvalRequired();
    if (!approvalRequired) return;

    await this.ethereumClient.checkAndApproveContract(ethereumAsset, oftAdapterAddress, amountWei);
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
