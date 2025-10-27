import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
import { PriceRule } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { IEntity } from '../entity';

export interface IbanCountryConfig {
  allowed: string[];
  notAllowed: string[];
}

@Entity()
export class Fiat extends IEntity {
  @Column({ unique: true, length: 256 })
  name: string;

  @Column({ default: false })
  buyable: boolean;

  @Column({ default: false })
  sellable: boolean;

  @Column({ default: false })
  cardBuyable: boolean;

  @Column({ default: false })
  cardSellable: boolean;

  @Column({ default: false })
  instantBuyable: boolean;

  @Column({ default: false })
  instantSellable: boolean;

  @Column({ default: true })
  refundEnabled: boolean;

  @ManyToOne(() => PriceRule)
  priceRule: PriceRule;

  @Column({ type: 'float', nullable: true })
  approxPriceChf?: number;

  @Column({ default: AmlRule.DEFAULT })
  amlRuleFrom: AmlRule;

  @Column({ default: AmlRule.DEFAULT })
  amlRuleTo: AmlRule;

  @Column({ length: 'MAX', nullable: true })
  ibanCountryConfig?: string; // JSON string

  get ibanCountryConfigObject(): IbanCountryConfig | undefined {
    return this.ibanCountryConfig ? (JSON.parse(this.ibanCountryConfig) as IbanCountryConfig) : undefined;
  }

  isIbanCountryAllowed(ibanCountry: string): boolean {
    const config = this.ibanCountryConfigObject;

    if (config?.allowed?.includes(ibanCountry)) {
      return true;
    } else if (
      config?.notAllowed?.includes(ibanCountry) ||
      config?.notAllowed?.includes('*') ||
      config?.allowed?.length
    ) {
      return false;
    } else {
      return true;
    }
  }
}
