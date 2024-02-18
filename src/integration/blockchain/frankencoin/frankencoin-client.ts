import { Contract, ethers } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import FRANKENCOIN_EQUITY_ABI from '../shared/evm/abi/frankencoin-equity.abi.json';
import FRANKENCOIN_POSITION_ABI from '../shared/evm/abi/frankencoin-position.abi.json';
import FRANKENCOIN_STABLECOIN_BRIDGE_ABI from '../shared/evm/abi/frankencoin-stablecoin-bridge.abi.json';
import FRANKENCOIN_ABI from '../shared/evm/abi/frankencoin.abi.json';
import {
  FrankencoinChallengeGraphDto,
  FrankencoinDelegationGraphDto,
  FrankencoinFpsGraphDto,
  FrankencoinMinterGraphDto,
  FrankencoinPositionGraphDto,
  FrankencoinTradeGraphDto,
} from './dto/frankencoin.dto';

export class FrankencoinClient {
  private provider: ethers.providers.JsonRpcProvider;

  constructor(gatewayUrl: string, apiKey: string) {
    const providerUrl = `${gatewayUrl}/${apiKey}`;
    this.provider = new ethers.providers.JsonRpcProvider(providerUrl);
  }

  async getPositions(): Promise<FrankencoinPositionGraphDto[]> {
    const document = gql`
      {
        positions {
          id
          position
          owner
          zchf
          collateral
          price
        }
      }
    `;

    return request<{ positions: [FrankencoinPositionGraphDto] }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.positions);
  }

  async getChallenges(): Promise<FrankencoinChallengeGraphDto[]> {
    const document = gql`
      {
        challenges {
          id
          challenger
          position
          start
          duration
          size
          filledSize
          acquiredCollateral
          number
          bid
          status
        }
      }
    `;

    return request<{ challenges: [FrankencoinChallengeGraphDto] }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.challenges);
  }

  async getFPS(): Promise<FrankencoinFpsGraphDto[]> {
    const document = gql`
      {
        fpss {
          id
          profits
          loss
          reserve
        }
      }
    `;

    return request<{ fpss: [FrankencoinFpsGraphDto] }>(Config.blockchain.frankencoin.zchfGraphUrl, document).then(
      (r) => r.fpss,
    );
  }

  async getMinters(): Promise<FrankencoinMinterGraphDto[]> {
    const document = gql`
      {
        minters {
          id
          minter
          applicationPeriod
          applicationFee
          applyMessage
          applyDate
          suggestor
          denyMessage
          denyDate
          vetor
        }
      }
    `;

    return request<{ minters: [FrankencoinMinterGraphDto] }>(Config.blockchain.frankencoin.zchfGraphUrl, document).then(
      (r) => r.minters,
    );
  }

  async getDelegations(): Promise<FrankencoinDelegationGraphDto[]> {
    const document = gql`
      {
        delegations {
          id
          owner
          delegatedTo
          pureDelegatedFrom
        }
      }
    `;

    return request<{ delegations: [FrankencoinDelegationGraphDto] }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.delegations);
  }

  async getTrades(): Promise<FrankencoinTradeGraphDto[]> {
    const document = gql`
      {
        trades {
          id
          trader
          amount
          shares
          price
          time
        }
      }
    `;

    return request<{ trades: [FrankencoinTradeGraphDto] }>(Config.blockchain.frankencoin.zchfGraphUrl, document).then(
      (r) => r.trades,
    );
  }

  getErc20Contract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, ERC20_ABI, this.provider);
  }

  getFrankencoinContract(contractAddress: string): Contract {
    return new Contract(contractAddress, FRANKENCOIN_ABI, this.provider);
  }

  getPositionContract(positionAddress: string): Contract {
    return new Contract(positionAddress, FRANKENCOIN_POSITION_ABI, this.provider);
  }

  getEquityContract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, FRANKENCOIN_EQUITY_ABI, this.provider);
  }

  getStablecoinBridgeContract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, FRANKENCOIN_STABLECOIN_BRIDGE_ABI, this.provider);
  }
}
