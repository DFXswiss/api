import { IknaAddressTag } from './ikna-address-tag.dto';

export interface IknaSanctionResult {
  testedAddress: string;
  isSanctioned: boolean | null;
  sanctionedAddress?: string;
  sanctionedAddressTags?: IknaAddressTag[];
}
