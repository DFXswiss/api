import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { Config } from 'src/config/config';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { FrankencoinService } from 'src/integration/blockchain/frankencoin/frankencoin.service';
import { JuiceService } from 'src/integration/blockchain/juice/juice.service';
import ERC20_ABI from 'src/integration/blockchain/shared/evm/abi/erc20.abi.json';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { FrankencoinBasedService } from 'src/integration/blockchain/shared/frankencoin/frankencoin-based.service';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { EquityPairConfig, EquityProtocol, getEquityPairConfig } from '../config/equity-pairs';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import { CustodyOrderStepCommand } from '../enums/custody';

@Injectable()
export class EquityOrderStepAdapter {
  private readonly logger = new DfxLogger(EquityOrderStepAdapter);

  constructor(
    private readonly blockchainRegistry: BlockchainRegistryService,
    private readonly frankencoinService: FrankencoinService,
    private readonly deuroService: DEuroService,
    private readonly juiceService: JuiceService,
  ) {}

  async execute(step: CustodyOrderStep): Promise<string> {
    switch (step.command) {
      case CustodyOrderStepCommand.CHARGE_CUSTODY:
        return this.chargeCustody(step);
      case CustodyOrderStepCommand.APPROVE_TOKEN:
        return this.approveToken(step);
      case CustodyOrderStepCommand.INVEST:
        return this.invest(step);
      case CustodyOrderStepCommand.REDEEM:
        return this.redeem(step);
    }
  }

  async isComplete(step: CustodyOrderStep): Promise<boolean> {
    const client = this.getEvmClient(step);
    return client.isTxComplete(step.correlationId);
  }

  async getOutputAmount(step: CustodyOrderStep): Promise<number> {
    const client = this.getEvmClient(step);
    const receipt = await client.getTxReceipt(step.correlationId);
    const custodyWallet = this.getCustodyWalletAddress(step);

    const targetAsset = step.order.inputAsset;
    const walletTopic = ethers.utils.hexZeroPad(custodyWallet.toLowerCase(), 32);

    const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');
    const transferLog = receipt?.logs?.find(
      (l) =>
        l.address.toLowerCase() === targetAsset.chainId.toLowerCase() &&
        l.topics[0] === transferTopic &&
        l.topics[2]?.toLowerCase() === walletTopic,
    );

    if (!transferLog) throw new Error(`Failed to get equity result for TX ${step.correlationId}`);

    return EvmUtil.fromWeiAmount(transferLog.data, targetAsset.decimals);
  }

  // --- COMMANDS --- //

  private async chargeCustody(step: CustodyOrderStep): Promise<string> {
    const client = this.getEvmClient(step);
    const custodyAddress = this.getCustodyWalletAddress(step);

    const gasPrice = await client.getRecommendedGasPrice();
    const isInvest = step.order.type === 'EquityInvest';
    const gasUnits = isInvest ? 400000 : 200000; // approve + invest, or just redeem
    const gasAmount = EvmUtil.fromWeiAmount(gasPrice.mul(gasUnits));
    const chargeAmount = gasAmount * 1.5; // 50% buffer

    return client.sendNativeCoinFromDex(custodyAddress, chargeAmount);
  }

  private async approveToken(step: CustodyOrderStep): Promise<string> {
    const client = this.getEvmClient(step);
    const custodyAccount = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);
    const service = this.getProtocolService(step);

    const stableAsset = step.order.outputAsset;
    const equityContractAddress = service.getEquityContract().address;

    const erc20Iface = new ethers.utils.Interface(ERC20_ABI);
    const data = erc20Iface.encodeFunctionData('approve', [equityContractAddress, ethers.constants.MaxUint256]);

    const tx = await client.sendRawTransactionFromAccount(custodyAccount, {
      to: stableAsset.chainId,
      data,
      gasLimit: ethers.BigNumber.from(100000),
    });

    return tx.hash;
  }

  private async invest(step: CustodyOrderStep): Promise<string> {
    const client = this.getEvmClient(step);
    const custodyAccount = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);
    const service = this.getProtocolService(step);

    const stableAsset = step.order.outputAsset;
    const amount = step.order.outputAmount;
    const weiAmount = EvmUtil.toWeiAmount(amount, stableAsset.decimals);

    const equityContract = service.getEquityContract();
    const expectedShares = await equityContract.calculateShares(weiAmount);
    const minShares = expectedShares.mul(98).div(100); // 2% slippage tolerance

    const data = equityContract.interface.encodeFunctionData('invest', [weiAmount, minShares]);

    const tx = await client.sendRawTransactionFromAccount(custodyAccount, {
      to: equityContract.address,
      data,
      gasLimit: ethers.BigNumber.from(300000),
    });

    return tx.hash;
  }

  private async redeem(step: CustodyOrderStep): Promise<string> {
    const client = this.getEvmClient(step);
    const custodyAccount = Config.blockchain.evm.custodyAccount(step.order.user.custodyAddressIndex);
    const service = this.getProtocolService(step);

    const equityAsset = step.order.outputAsset;
    const amount = step.order.outputAmount;
    const weiAmount = EvmUtil.toWeiAmount(amount, equityAsset.decimals);

    const custodyAddress = this.getCustodyWalletAddress(step);
    const equityContract = service.getEquityContract();

    const data = equityContract.interface.encodeFunctionData('redeem', [custodyAddress, weiAmount]);

    const tx = await client.sendRawTransactionFromAccount(custodyAccount, {
      to: equityContract.address,
      data,
      gasLimit: ethers.BigNumber.from(300000),
    });

    return tx.hash;
  }

  // --- HELPERS --- //

  private getEquityPair(step: CustodyOrderStep): { config: EquityPairConfig; direction: 'invest' | 'redeem' } {
    const sourceAsset = step.order.outputAsset;
    const targetAsset = step.order.inputAsset;

    const pair = getEquityPairConfig(sourceAsset.name, targetAsset.name);
    if (!pair) throw new Error(`No equity pair found for ${sourceAsset.name} -> ${targetAsset.name}`);

    return pair;
  }

  private getProtocolService(step: CustodyOrderStep): FrankencoinBasedService {
    const { config } = this.getEquityPair(step);

    switch (config.protocol) {
      case EquityProtocol.FRANKENCOIN:
        return this.frankencoinService;
      case EquityProtocol.DEURO:
        return this.deuroService;
      case EquityProtocol.JUICE:
        return this.juiceService;
    }
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
