import { Asset } from "src/shared/models/asset/asset.entity";

export class BuyDto {
    id: number;
    active: boolean;
    iban: string;
    asset: Asset;
    bankUsage: string;
    volume: number;
    annualVolume: number;
    fee: number;
    refBonus: number;
}
