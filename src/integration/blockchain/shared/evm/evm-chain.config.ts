import { Chain, Hex, Address, parseAbi } from 'viem';
import { mainnet, arbitrum, optimism, polygon, base, bsc, gnosis, sepolia } from 'viem/chains';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

// ERC20 ABI - common across all EVM services
export const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

// Chain configuration mapping
export interface EvmChainConfig {
  chain: Chain;
  configKey: string;
  prefix: string;
  pimlicoName?: string;
}

export const EVM_CHAIN_CONFIG: Partial<Record<Blockchain, EvmChainConfig>> = {
  [Blockchain.ETHEREUM]: { chain: mainnet, configKey: 'ethereum', prefix: 'eth', pimlicoName: 'ethereum' },
  [Blockchain.ARBITRUM]: { chain: arbitrum, configKey: 'arbitrum', prefix: 'arbitrum', pimlicoName: 'arbitrum' },
  [Blockchain.OPTIMISM]: { chain: optimism, configKey: 'optimism', prefix: 'optimism', pimlicoName: 'optimism' },
  [Blockchain.POLYGON]: { chain: polygon, configKey: 'polygon', prefix: 'polygon', pimlicoName: 'polygon' },
  [Blockchain.BASE]: { chain: base, configKey: 'base', prefix: 'base', pimlicoName: 'base' },
  [Blockchain.BINANCE_SMART_CHAIN]: { chain: bsc, configKey: 'bsc', prefix: 'bsc', pimlicoName: 'binance' },
  [Blockchain.GNOSIS]: { chain: gnosis, configKey: 'gnosis', prefix: 'gnosis', pimlicoName: 'gnosis' },
  [Blockchain.SEPOLIA]: { chain: sepolia, configKey: 'sepolia', prefix: 'sepolia', pimlicoName: 'sepolia' },
};

/**
 * Get full chain configuration including RPC URL
 */
export function getEvmChainConfig(blockchain: Blockchain): { chain: Chain; rpcUrl: string } | undefined {
  const config = EVM_CHAIN_CONFIG[blockchain];
  if (!config) return undefined;

  const blockchainConfig = GetConfig().blockchain;
  const chainConfig = blockchainConfig[config.configKey];
  const rpcUrl = `${chainConfig[`${config.prefix}GatewayUrl`]}/${chainConfig[`${config.prefix}ApiKey`] ?? ''}`;

  return { chain: config.chain, rpcUrl };
}

/**
 * Get relayer private key for the blockchain
 */
export function getRelayerPrivateKey(blockchain: Blockchain): Hex {
  const config = EVM_CHAIN_CONFIG[blockchain];
  if (!config) throw new Error(`No config found for ${blockchain}`);

  const blockchainConfig = GetConfig().blockchain;
  const key = blockchainConfig[config.configKey][`${config.prefix}WalletPrivateKey`];
  if (!key) throw new Error(`No relayer private key configured for ${blockchain}`);

  return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
}

/**
 * Check if a blockchain is supported for EVM operations
 */
export function isEvmBlockchainSupported(blockchain: Blockchain): boolean {
  return EVM_CHAIN_CONFIG[blockchain] !== undefined;
}
