import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { Config } from 'src/config/config';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { EquityPairMatch, EquityPairService } from '../services/equity-pair.service';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import { CustodyOrderStepCommand, CustodyOrderType } from '../enums/custody';

@Injectable()
export class EquityOrderStepAdapter {
  private readonly logger = new DfxLogger(EquityOrderStepAdapter);

  constructor(
    private readonly blockchainRegistry: BlockchainRegistryService,
    private readonly equityPairService: EquityPairService,
  ) {}

  async execute(step: CustodyOrderStep): Promise<string> {
    switch (step.command) {
      case CustodyOrderStepCommand.CHARGE_CUSTODY:
        return this.chargeCustody(step);
      case CustodyOrderStepCommand.APPROVE_TOKEN:
        return this.approveToken(step);
      case CustodyOrderStepCommand.MINT:
        return this.mint(step);
      case CustodyOrderStepCommand.REDEEM:
        return this.redeem(step);
      default:
        throw new Error(`Unsupported equity step command: ${step.command}`);
    }
  }

  async isComplete(step: CustodyOrderStep): Promise<boolean> {
    const client = this.getEvmClient(step);
    return client.isTxComplete(step.correlationId);
  }

  async getOutputAmount(step: CustodyOrderStep): Promise<number> {
    const client = this.getEvmClient(step);
    const custodyAddress = this.getCustodyWalletAddress(step);

    return client.getSwapResult(step.correlationId, step.order.inputAsset, custodyAddress);
  }

  // --- COMMANDS --- //

  private async chargeCustody(step: CustodyOrderStep): Promise<string> {
    const client = this.getEvmClient(step);
    const custodyAddress = this.getCustodyWalletAddress(step);

    const gasPrice = await client.getRecommendedGasPrice();
    const isMint = step.order.type === CustodyOrderType.EQUITY_MINT;
    const gasUnits = isMint ? 400000 : 200000; // approve + mint, or just redeem
    const gasAmount = EvmUtil.fromWeiAmount(gasPrice.mul(gasUnits));
    const chargeAmount = gasAmount * 1.5; // 50% buffer

    return client.sendNativeCoinFromDex(custodyAddress, chargeAmount);
  }

  private async approveToken(step: CustodyOrderStep): Promise<string> {
    const client = this.getEvmClient(step);
    const custodyAccount = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);
    const { config } = this.getEquityPair(step);

    const stableAsset = step.order.outputAsset;
    const equityContractAddress = config.service.getEquityContract().address;

    const erc20Iface = new ethers.utils.Interface(ERC20_ABI);
    const data = erc20Iface.encodeFunctionData('approve', [equityContractAddress, ethers.constants.MaxUint256]);

    const tx = await client.sendRawTransactionFromAccount(custodyAccount, {
      to: stableAsset.chainId,
      data,
      value: 0,
      gasLimit: ethers.BigNumber.from(100000),
    });

    return tx.hash;
  }

  private async mint(step: CustodyOrderStep): Promise<string> {
    const client = this.getEvmClient(step);
    const custodyAccount = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);
    const { config } = this.getEquityPair(step);

    const stableAsset = step.order.outputAsset;
    const amount = step.order.outputAmount;
    const weiAmount = EvmUtil.toWeiAmount(amount, stableAsset.decimals);

    const equityContract = config.service.getEquityContract();
    const expectedShares = await equityContract.calculateShares(weiAmount);
    const minShares = expectedShares.mul(98).div(100); // 2% slippage tolerance

    const data = equityContract.interface.encodeFunctionData('invest', [weiAmount, minShares]);

    const tx = await client.sendRawTransactionFromAccount(custodyAccount, {
      to: equityContract.address,
      data,
      value: 0,
      gasLimit: ethers.BigNumber.from(300000),
    });

    return tx.hash;
  }

  private async redeem(step: CustodyOrderStep): Promise<string> {
    const client = this.getEvmClient(step);
    const custodyAccount = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);
    const { config } = this.getEquityPair(step);

    const equityAsset = step.order.outputAsset;
    const amount = step.order.outputAmount;
    const weiAmount = EvmUtil.toWeiAmount(amount, equityAsset.decimals);

    const custodyAddress = this.getCustodyWalletAddress(step);
    const equityContract = config.service.getEquityContract();

    const equityPrice = await config.service.getEquityPrice();
    const expectedProceeds = EvmUtil.toWeiAmount(amount * equityPrice * 0.98, 18); // 2% slippage tolerance

    const data = equityContract.interface.encodeFunctionData('redeemExpected', [
      custodyAddress,
      weiAmount,
      expectedProceeds,
    ]);

    const tx = await client.sendRawTransactionFromAccount(custodyAccount, {
      to: equityContract.address,
      data,
      value: 0,
      gasLimit: ethers.BigNumber.from(300000),
    });

    return tx.hash;
  }

  // --- HELPERS --- //

  private getEquityPair(step: CustodyOrderStep): EquityPairMatch {
    const sourceAsset = step.order.outputAsset;
    const targetAsset = step.order.inputAsset;

    const pair = this.equityPairService.getEquityPairConfig(sourceAsset.name, targetAsset.name);
    if (!pair) throw new Error(`No equity pair found for ${sourceAsset.name} -> ${targetAsset.name}`);

    return pair;
  }

  private getEvmClient(step: CustodyOrderStep): EvmClient {
    const { config } = this.getEquityPair(step);
    return this.blockchainRegistry.getEvmClient(config.blockchain);
  }

  private getCustodyWalletAddress(step: CustodyOrderStep): string {
    const custodyAccount = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);
    return EvmUtil.createWallet(custodyAccount).address;
  }
}
