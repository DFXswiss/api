import { BadRequestException, Injectable } from '@nestjs/common';
import { Contract, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import {
  AllowlistStatusDto,
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSellPriceDto,
  BrokerbotSellTxDto,
  BrokerbotSharesDto,
  Permit2ApprovalDto,
  Permit2ApproveTxDto,
  RealUnitAtomicSellResponse,
  RealUnitPermitDto,
} from 'src/integration/realunit/dto/realunit.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Blockchain } from '../shared/enums/blockchain.enum';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import { EvmClient } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { BlockchainRegistryService } from '../shared/services/blockchain-registry.service';

// Contract ABIs
const BROKERBOT_ABI = [
  'function getPrice() public view returns (uint256)',
  'function getBuyPrice(uint256 shares) public view returns (uint256)',
  'function getSellPrice(uint256 shares) public view returns (uint256)',
  'function getShares(uint256 money) public view returns (uint256)',
  'function settings() public view returns (uint256)',
];

const REALU_TOKEN_ABI = [
  'function canReceiveFromAnyone(address account) public view returns (bool)',
  'function isForbidden(address account) public view returns (bool)',
  'function isPowerlisted(address account) public view returns (bool)',
  'function transferAndCall(address to, uint256 value, bytes data) public returns (bool)',
];

// Reusable interfaces for encoding/decoding
const TRANSFER_AND_CALL_IFACE = new ethers.utils.Interface([
  'function transferAndCall(address to, uint256 value, bytes data)',
]);

const APPROVE_IFACE = new ethers.utils.Interface(['function approve(address spender, uint256 amount)']);

@Injectable()
export class RealUnitBlockchainService {
  private readonly config = GetConfig().blockchain.realunit;
  private readonly ethereumConfig = GetConfig().blockchain.ethereum;

  constructor(
    private readonly registryService: BlockchainRegistryService,
    private readonly assetService: AssetService,
  ) {}

  private async getZchfAsset(): Promise<Asset> {
    return this.assetService.getAssetByUniqueName('Ethereum/ZCHF');
  }

  private async getRealuAsset(): Promise<Asset> {
    return this.assetService.getAssetByUniqueName('Ethereum/REALU');
  }

  private getEvmClient(): EvmClient {
    return this.registryService.getClient(Blockchain.ETHEREUM) as EvmClient;
  }

  private getBrokerbotContract(): Contract {
    return new Contract(this.config.brokerbotAddress, BROKERBOT_ABI, this.getEvmClient().wallet);
  }

  private async getRealuTokenContract(): Promise<Contract> {
    const realuAsset = await this.getRealuAsset();
    return new Contract(realuAsset.chainId, REALU_TOKEN_ABI, this.getEvmClient().wallet);
  }

  private async getZchfContract(): Promise<Contract> {
    const zchfAsset = await this.getZchfAsset();
    return new Contract(zchfAsset.chainId, ERC20_ABI, this.getEvmClient().wallet);
  }

  async getRealUnitPrice(): Promise<number> {
    const price = await this.getBrokerbotContract().getPrice();
    return EvmUtil.fromWeiAmount(price);
  }

  // --- Brokerbot Methods ---

  async getBrokerbotPrice(): Promise<BrokerbotPriceDto> {
    const priceRaw = await this.getBrokerbotContract().getPrice();
    return {
      pricePerShare: EvmUtil.fromWeiAmount(priceRaw).toString(),
      pricePerShareRaw: priceRaw.toString(),
    };
  }

  async getBrokerbotBuyPrice(shares: number): Promise<BrokerbotBuyPriceDto> {
    const contract = this.getBrokerbotContract();
    const [totalPriceRaw, pricePerShareRaw] = await Promise.all([
      contract.getBuyPrice(shares),
      contract.getPrice(),
    ]);

    return {
      shares,
      totalPrice: EvmUtil.fromWeiAmount(totalPriceRaw).toString(),
      totalPriceRaw: totalPriceRaw.toString(),
      pricePerShare: EvmUtil.fromWeiAmount(pricePerShareRaw).toString(),
    };
  }

  async getBrokerbotSellPrice(shares: number): Promise<BrokerbotSellPriceDto> {
    const contract = this.getBrokerbotContract();
    const [totalProceedsRaw, pricePerShareRaw] = await Promise.all([
      contract.getSellPrice(shares),
      contract.getPrice(),
    ]);

    return {
      shares,
      totalProceeds: EvmUtil.fromWeiAmount(totalProceedsRaw).toString(),
      totalProceedsRaw: totalProceedsRaw.toString(),
      pricePerShare: EvmUtil.fromWeiAmount(pricePerShareRaw).toString(),
    };
  }

  async getBrokerbotShares(amountChf: string): Promise<BrokerbotSharesDto> {
    const contract = this.getBrokerbotContract();
    const amountWei = EvmUtil.toWeiAmount(parseFloat(amountChf));
    const [shares, pricePerShareRaw] = await Promise.all([
      contract.getShares(amountWei),
      contract.getPrice(),
    ]);

    return {
      amount: amountChf,
      shares: shares.toNumber(),
      pricePerShare: EvmUtil.fromWeiAmount(pricePerShareRaw).toString(),
    };
  }

  async getAllowlistStatus(address: string): Promise<AllowlistStatusDto> {
    const contract = await this.getRealuTokenContract();
    const [canReceive, isForbidden, isPowerlisted] = await Promise.all([
      contract.canReceiveFromAnyone(address),
      contract.isForbidden(address),
      contract.isPowerlisted(address),
    ]);

    return {
      address,
      canReceive,
      isForbidden,
      isPowerlisted,
    };
  }

  async getBrokerbotInfo(): Promise<BrokerbotInfoDto> {
    const contract = this.getBrokerbotContract();
    const [priceRaw, settings, zchfAsset, realuAsset] = await Promise.all([
      contract.getPrice(),
      contract.settings(),
      this.getZchfAsset(),
      this.getRealuAsset(),
    ]);

    // Settings bitmask: bit 0 = buying enabled, bit 1 = selling enabled
    const buyingEnabled = (settings.toNumber() & 1) === 1;
    const sellingEnabled = (settings.toNumber() & 2) === 2;

    return {
      brokerbotAddress: this.config.brokerbotAddress,
      tokenAddress: realuAsset.chainId,
      baseCurrencyAddress: zchfAsset.chainId,
      pricePerShare: EvmUtil.fromWeiAmount(priceRaw).toString(),
      buyingEnabled,
      sellingEnabled,
    };
  }

  // --- Sell Methods ---

  /**
   * Decodes and validates a signed Brokerbot sell transaction
   * Returns the number of shares being sold and the sender address
   */
  async validateBrokerbotSellTx(signedTx: string): Promise<{ sender: string; shares: number }> {
    const tx = ethers.utils.parseTransaction(signedTx);
    const realuAsset = await this.getRealuAsset();

    // Validate target is REALU token (selling sends REALU to Brokerbot)
    if (tx.to?.toLowerCase() !== realuAsset.chainId.toLowerCase()) {
      throw new BadRequestException('WRONG_CONTRACT: Transaction must transfer REALU tokens');
    }

    // Decode the function call - selling uses transferAndCall to Brokerbot
    try {
      const decoded = TRANSFER_AND_CALL_IFACE.decodeFunctionData('transferAndCall', tx.data);
      // Verify destination is Brokerbot
      if (decoded.to.toLowerCase() !== this.config.brokerbotAddress.toLowerCase()) {
        throw new BadRequestException('WRONG_CONTRACT: Transfer destination is not Brokerbot');
      }
      return { sender: tx.from, shares: decoded.value.toNumber() };
    } catch {
      throw new BadRequestException('WRONG_METHOD: Expected transferAndCall to Brokerbot');
    }
  }

  /**
   * Broadcasts a signed transaction and returns the tx hash
   */
  async broadcastSignedTransaction(signedTx: string): Promise<string> {
    const result = await this.getEvmClient().sendSignedTransaction(signedTx);
    if (result.error) {
      throw new BadRequestException(`BROADCAST_FAILED: ${result.error.message}`);
    }
    return result.response.hash;
  }

  /**
   * Waits for a transaction to be confirmed
   */
  async waitForTransaction(txHash: string): Promise<void> {
    const client = this.getEvmClient();
    for (let i = 0; i < 60; i++) {
      if (await client.isTxComplete(txHash)) return;
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new BadRequestException('BROADCAST_FAILED: Transaction confirmation timeout');
  }

  // --- TX Preparation Methods ---

  /**
   * Prepares transaction data for client to sign (transferAndCall to Brokerbot)
   */
  async prepareSellTx(shares: number, minPrice?: string): Promise<BrokerbotSellTxDto> {
    // Get expected price and REALU address in parallel
    const [sellPrice, realuAsset] = await Promise.all([
      this.getBrokerbotSellPrice(shares),
      this.getRealuAsset(),
    ]);

    // Check minimum price if provided
    if (minPrice && parseFloat(sellPrice.totalProceeds) < parseFloat(minPrice)) {
      throw new BadRequestException(
        `PRICE_TOO_LOW: Expected ${sellPrice.totalProceeds} ZCHF but minimum is ${minPrice}`,
      );
    }

    // Encode transferAndCall function
    const encodedData = TRANSFER_AND_CALL_IFACE.encodeFunctionData('transferAndCall', [
      this.config.brokerbotAddress,
      shares,
      '0x',
    ]);

    // Estimate gas
    const gasLimit = 150000; // Conservative estimate for transferAndCall

    return {
      to: realuAsset.chainId,
      data: encodedData,
      value: '0',
      gasLimit: gasLimit.toString(),
      chainId: 1,
      expectedShares: shares,
      expectedPrice: sellPrice.totalProceeds,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
    };
  }

  /**
   * Gets ZCHF allowance for Permit2 contract
   */
  async getPermit2Approval(address: string): Promise<Permit2ApprovalDto> {
    const contract = await this.getZchfContract();
    const allowanceRaw = await contract.allowance(address, this.ethereumConfig.permit2Address);
    const allowance = EvmUtil.fromWeiAmount(allowanceRaw);

    return {
      address,
      spender: this.ethereumConfig.permit2Address,
      allowance: allowance.toString(),
      isApproved: allowanceRaw.gt(0),
      isUnlimited: allowanceRaw.eq(ethers.constants.MaxUint256),
    };
  }

  /**
   * Prepares approve transaction for Permit2 contract
   */
  async prepareApproveTx(unlimited = true): Promise<Permit2ApproveTxDto> {
    const [zchfAsset, amount] = await Promise.all([
      this.getZchfAsset(),
      Promise.resolve(unlimited ? ethers.constants.MaxUint256 : ethers.BigNumber.from(0)),
    ]);
    const encodedData = APPROVE_IFACE.encodeFunctionData('approve', [this.ethereumConfig.permit2Address, amount]);

    return {
      to: zchfAsset.chainId,
      data: encodedData,
      value: '0',
      gasLimit: '60000',
      chainId: 1,
      approvalAmount: unlimited ? 'unlimited' : '0',
    };
  }

  // --- Atomic Sell Methods ---

  /**
   * Validates that the Permit2 amount matches the expected Brokerbot output
   */
  async validateAtomicSell(
    signedBrokerbotTx: string,
    permit: RealUnitPermitDto,
  ): Promise<{ sender: string; shares: number; expectedZchfWei: string }> {
    // 1. Validate Brokerbot TX and get shares
    const { sender, shares } = await this.validateBrokerbotSellTx(signedBrokerbotTx);

    // 2. Get expected ZCHF output from Brokerbot
    const sellPrice = await this.getBrokerbotSellPrice(shares);
    const expectedZchfWei = sellPrice.totalProceedsRaw;

    // 3. Validate Permit2 amount matches expected output
    if (permit.amount !== expectedZchfWei) {
      throw new BadRequestException(
        `AMOUNT_MISMATCH: Permit2 amount (${permit.amount}) does not match expected ZCHF output (${expectedZchfWei})`,
      );
    }

    // 4. Validate Permit2 deadline is not expired
    const now = Math.floor(Date.now() / 1000);
    if (permit.deadline <= now) {
      throw new BadRequestException('PERMIT_EXPIRED: Permit2 deadline has passed');
    }

    return { sender, shares, expectedZchfWei };
  }

  /**
   * Executes the atomic sell: broadcasts Brokerbot TX, then executes Permit2 transfer
   */
  async executeAtomicSell(
    signedBrokerbotTx: string,
    permit: RealUnitPermitDto,
  ): Promise<RealUnitAtomicSellResponse> {
    // 1. Validate everything first
    const { sender, shares, expectedZchfWei } = await this.validateAtomicSell(signedBrokerbotTx, permit);

    // 2. Broadcast Brokerbot TX
    const brokerbotTxHash = await this.broadcastSignedTransaction(signedBrokerbotTx);

    // 3. Wait for Brokerbot TX confirmation
    await this.waitForTransaction(brokerbotTxHash);

    // 4. Execute Permit2 transfer (ZCHF from user to DFX)
    const zchfAsset = await this.getZchfAsset();
    const client = this.getEvmClient();

    const permitTxHash = await client.permitTransfer(
      sender,
      permit.signature,
      this.ethereumConfig.permit2Address,
      zchfAsset,
      EvmUtil.fromWeiAmount(ethers.BigNumber.from(permit.amount), zchfAsset.decimals),
      EvmUtil.fromWeiAmount(ethers.BigNumber.from(permit.amount), zchfAsset.decimals),
      client.walletAddress,
      permit.nonce,
      permit.deadline,
    );

    return {
      brokerbotTxHash,
      permitTxHash,
      shares,
      zchfReceived: EvmUtil.fromWeiAmount(ethers.BigNumber.from(expectedZchfWei)).toString(),
      zchfTransferred: EvmUtil.fromWeiAmount(ethers.BigNumber.from(permit.amount)).toString(),
    };
  }
}
