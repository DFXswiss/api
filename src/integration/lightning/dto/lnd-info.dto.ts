export interface LndInfoDto {
  version: string;
  identity_pubkey: string;
  num_active_channels: number;
  block_height: number;
  synced_to_chain: boolean;
}
