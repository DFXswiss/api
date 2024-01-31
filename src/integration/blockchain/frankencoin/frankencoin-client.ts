import { Contract, ethers } from 'ethers';
import { gql, request } from 'graphql-request';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import FRANKENCOIN_POSITION_ABI from '../shared/evm/abi/frankencoin-position.abi.json';
import FRANKENCOIN_ABI from '../shared/evm/abi/frankencoin.abi.json';
import {
  FrankencoinChallengeDto,
  FrankencoinDelegationDto,
  FrankencoinFpsDto,
  FrankencoinMinterDto,
  FrankencoinPositionDto,
  FrankencoinTradeDto,
} from './dto/frankencoin.dto';

export class FrankencoinClient {
  private url = 'https://api.thegraph.com/subgraphs/name/frankencoin-zchf/frankencoin-subgraph';

  private provider: ethers.providers.JsonRpcProvider;

  constructor(gatewayUrl: string, apiKey: string) {
    const url = `${gatewayUrl}/${apiKey}`;
    this.provider = new ethers.providers.JsonRpcProvider(url);
  }

  async getPositions(): Promise<FrankencoinPositionDto[]> {
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

    return request<{ positions: [FrankencoinPositionDto] }>(this.url, document).then((r) => r.positions);
  }

  async getChallenges(): Promise<FrankencoinChallengeDto[]> {
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

    return request<{ challenges: [FrankencoinChallengeDto] }>(this.url, document).then((r) => r.challenges);
  }

  async getFPS(): Promise<FrankencoinFpsDto[]> {
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

    return request<{ fpss: [FrankencoinFpsDto] }>(this.url, document).then((r) => r.fpss);
  }

  async getMinters(): Promise<FrankencoinMinterDto[]> {
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

    return request<{ minters: [FrankencoinMinterDto] }>(this.url, document).then((r) => r.minters);
  }

  async getDelegations(): Promise<FrankencoinDelegationDto[]> {
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

    return request<{ delegations: [FrankencoinDelegationDto] }>(this.url, document).then((r) => r.delegations);
  }

  async getTrades(): Promise<FrankencoinTradeDto[]> {
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

    return request<{ trades: [FrankencoinTradeDto] }>(this.url, document).then((r) => r.trades);
  }

  getFrankencoinContract(contractAddress: string): Contract {
    return new Contract(contractAddress, FRANKENCOIN_ABI, this.provider);
  }

  getPositionContract(positionAddress: string): Contract {
    return new Contract(positionAddress, FRANKENCOIN_POSITION_ABI, this.provider);
  }

  getCollateralContract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, ERC20_ABI, this.provider);
  }
}
