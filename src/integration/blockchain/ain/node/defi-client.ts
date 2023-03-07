import { AccountHistory, AccountResult, UTXO as SpendUTXO } from '@defichain/jellyfish-api-core/dist/category/account';
import { ProposalStatus } from '@defichain/jellyfish-api-core/dist/category/governance';
import { SchedulerRegistry } from '@nestjs/schedule';
import BigNumber from 'bignumber.js';
import { HttpService } from 'src/shared/services/http.service';
import { NodeClient, NodeCommand, NodeMode } from './node-client';

export interface Proposal {
  proposalId: string;
  title: string;
  context: string;
  contextHash: string;
  creationHeight: number;
  status: ProposalStatus;
  type: ProposalType;
  amount: number;
  payoutAddress: string;
  currentCycle: number;
  totalCycles: number;
  cycleEndHeight: number;
  proposalEndHeight: number;
  votingPeriod: number;
  quorum: string;
  votesPossible: number;
  votesPresent: number;
  votesPresentPct: string;
  votesYes: number;
  votesYesPct: string;
  approvalThreshold: string;
  fee: number;
  options: string[];
}

enum VoteResult {
  YES = 'YES',
  NO = 'NO',
  NEUTRAL = 'NEUTRAL',
}

export interface ProposalVote {
  proposalId: string;
  masternodeId: string;
  cycle: number;
  vote: VoteResult;
}

export enum ProposalType {
  COMMUNITY_FUND_PROPOSAL = 'CommunityFundProposal',
  BLOCK_REWARD_RELLOCATION = 'BlockRewardRellocation',
  VOTE_OF_CONFIDENCE = 'VoteOfConfidence',
}

export class DeFiClient extends NodeClient {
  constructor(http: HttpService, url: string, scheduler: SchedulerRegistry, mode: NodeMode) {
    super(http, url, scheduler, mode);
  }

  // common
  async getHistory(fromBlock: number, toBlock: number, address?: string): Promise<AccountHistory[]> {
    return this.callNode((c) =>
      c.account.listAccountHistory(address, {
        depth: toBlock - fromBlock,
        maxBlockHeight: toBlock,
        no_rewards: true,
        limit: 1000000,
      }),
    );
  }

  async getNodeBalance(): Promise<{ utxo: BigNumber; token: number }> {
    return { utxo: await this.getBalance(), token: await this.getToken().then((t) => t.length) };
  }

  // UTXO
  get utxoFee(): number {
    return this.chain === 'mainnet' ? 0.00000132 : 0.0000222;
  }

  async sendUtxo(addressFrom: string, addressTo: string, amount: number): Promise<string> {
    return this.callNode(
      (c) => c.call(NodeCommand.SEND_UTXO, [addressFrom, addressTo, this.roundAmount(amount)], 'number'),
      true,
    );
  }

  async sendCompleteUtxo(
    addressFrom: string,
    addressTo: string,
    amount: number,
  ): Promise<{ outTxId: string; feeAmount: number }> {
    const outTxId = await this.callNode<string>(
      (c) =>
        c.call(
          NodeCommand.SEND_UTXO,
          [addressFrom, addressTo, this.roundAmount(amount - this.utxoFee), addressTo],
          'number',
        ),
      true,
    );
    return { outTxId, feeAmount: this.utxoFee };
  }

  // token
  async getToken(): Promise<AccountResult<string, string>[]> {
    return this.callNode((c) => c.account.listAccounts({}, false, { indexedAmounts: false, isMineOnly: true }));
  }

  async testCompositeSwap(tokenFrom: string, tokenTo: string, amount: number): Promise<number> {
    if (tokenFrom === tokenTo) return amount;

    return this.callNode((c) =>
      c.call(
        NodeCommand.TEST_POOL_SWAP,
        [
          {
            from: undefined,
            tokenFrom: tokenFrom,
            amountFrom: this.roundAmount(amount),
            to: undefined,
            tokenTo: tokenTo,
          },
          'auto',
        ],
        'number',
      ),
    ).then((r: string) => this.parseAmount(r).amount);
  }

  async compositeSwap(
    addressFrom: string,
    tokenFrom: string,
    addressTo: string,
    tokenTo: string,
    amount: number,
    utxos?: SpendUTXO[],
    maxPrice?: number,
  ): Promise<string> {
    return this.callNode(
      (c) =>
        c.poolpair.compositeSwap(
          {
            from: addressFrom,
            tokenFrom: tokenFrom,
            amountFrom: this.roundAmount(amount),
            to: addressTo,
            tokenTo: tokenTo,
            maxPrice,
          },
          utxos,
        ),
      true,
    );
  }

  async addPoolLiquidity(address: string, assetsPair: [string, string]): Promise<string> {
    return this.callNode((c) => c.poolpair.addPoolLiquidity({ [address]: assetsPair }, address), true);
  }

  async sendToken(
    addressFrom: string,
    addressTo: string,
    token: string,
    amount: number,
    utxos: SpendUTXO[] = [],
  ): Promise<string> {
    return token === 'DFI'
      ? this.toUtxo(addressFrom, addressTo, amount, utxos)
      : this.callNode(
          (c) =>
            c.account.accountToAccount(addressFrom, { [addressTo]: `${this.roundAmount(amount)}@${token}` }, { utxos }),
          true,
        );
  }

  async sendTokenToMany(
    addressFrom: string,
    token: string,
    payload: { addressTo: string; amount: number }[],
    utxos: SpendUTXO[] = [],
  ): Promise<string> {
    if (payload.length > 10) {
      throw new Error('Too many addresses in one transaction batch, allowed max 10 for tokens');
    }

    const batch = payload.reduce((acc, p) => ({ ...acc, [p.addressTo]: `${p.amount}@${token}` }), {});

    return this.callNode((c) => c.account.accountToAccount(addressFrom, batch, { utxos }), true);
  }

  async toUtxo(addressFrom: string, addressTo: string, amount: number, utxos?: SpendUTXO[]): Promise<string> {
    return this.callNode(
      (c) => c.account.accountToUtxos(addressFrom, { [addressTo]: `${this.roundAmount(amount)}@DFI` }, { utxos }),
      true,
    );
  }

  async toToken(address: string, amount: number, utxos?: SpendUTXO[]): Promise<string> {
    return this.callNode(
      (c) => c.account.utxosToAccount({ [address]: `${this.roundAmount(amount)}@DFI` }, utxos),
      true,
    );
  }

  async removePoolLiquidity(address: string, amount: string, utxos?: SpendUTXO[]): Promise<string> {
    return this.callNode((c) => c.poolpair.removePoolLiquidity(address, amount, { utxos }), true);
  }

  //Voting

  async listProposal(): Promise<Proposal[]> {
    return this.callNode((c) => c.call('listgovproposals', ['all', 'all', 0, { limit: 1000000 }], 'number'), true);
  }

  async getProposal(proposalId: string): Promise<Proposal> {
    return this.callNode((c) => c.call('getgovproposal', [proposalId], 'number'), true);
  }

  async listVotes(proposalId: string): Promise<ProposalVote[]> {
    return this.callNode(
      (c) => c.call('listgovproposalvotes', [proposalId, 'all', 0, { limit: 1000000 }], 'number'),
      true,
    );
  }
}
