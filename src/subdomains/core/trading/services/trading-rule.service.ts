import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IsNull, Not } from 'typeorm';
import { TradingOrderOutputDtoMapper } from '../dto/output/mappers/trading-order-output-dto.mapper';
import { TradingRuleOutputDtoMapper } from '../dto/output/mappers/trading-rule-output-dto.mapper';
import { TradingOrderOutputDto } from '../dto/output/trading-order-output.dto';
import { TradingRuleOutputDto } from '../dto/output/trading-rule-output.dto';
import { TradingOrder } from '../entities/trading-order.entity';
import { TradingRule } from '../entities/trading-rule.entity';
import { TradingRuleStatus } from '../enums';
import { TradingOrderRepository } from '../repositories/trading-order.respoitory';
import { TradingRuleRepository } from '../repositories/trading-rule.respoitory';
import { TradingRegistryService } from './trading-registry.service';

@Injectable()
export class TradingRuleService {
  private readonly logger = new DfxLogger(TradingRuleService);

  @Inject() private readonly ruleRepo: TradingRuleRepository;
  @Inject() private readonly orderRepo: TradingOrderRepository;

  constructor(private readonly tradingRegistryService: TradingRegistryService) {}

  // --- PUBLIC API --- //

  async processRules() {
    this.logger.verbose('Trading Rule: processRules()');

    const rules = await this.ruleRepo.findBy({
      status: TradingRuleStatus.ACTIVE,
    });

    for (const rule of rules) {
      await this.executeRule(rule);
    }
  }

  async processRule(ruleId: number): Promise<TradingOrderOutputDto> {
    const rule = await this.ruleRepo.findOneBy({
      id: ruleId,
      status: TradingRuleStatus.ACTIVE,
    });

    if (!rule) {
      const message = `Rule ${ruleId} in status active not found`;
      this.logger.info(message);
      return new TradingOrderOutputDto().setErrorMessage(message);
    }

    return this.executeRule(rule);
  }

  async reactivateRules(): Promise<void> {
    const rules = await this.ruleRepo.findBy({
      status: TradingRuleStatus.PAUSED,
      reactivationTime: Not(IsNull()),
    });

    for (const rule of rules) {
      if (rule.shouldReactivate()) {
        rule.reactivate();
        await this.ruleRepo.save(rule);
        this.logger.info(`Reactivated trading rule ${rule.id}`);
      }
    }
  }

  async reactivateRule(id: number): Promise<TradingRuleOutputDto> {
    const rule = await this.ruleRepo.findOneBy({ id });

    if (!rule) throw new NotFoundException(`Trading rule ${id} not found`);

    rule.reactivate();

    return TradingRuleOutputDtoMapper.entityToDto(await this.ruleRepo.save(rule));
  }

  async deactivateRule(id: number): Promise<TradingRuleOutputDto> {
    const rule = await this.ruleRepo.findOneBy({ id });

    if (!rule) throw new NotFoundException(`Trading rule ${id} not found`);

    rule.deactivate();

    return TradingRuleOutputDtoMapper.entityToDto(await this.ruleRepo.save(rule));
  }

  // --- HELPER METHODS --- //

  private async executeRule(rule: TradingRule): Promise<TradingOrderOutputDto> {
    this.logger.verbose('Trading Rule: executeRule()');

    try {
      if (!rule.isActive()) {
        const message = `Could not execute rule ${rule.id}: status is ${rule.status}`;
        this.logger.info(message);
        return new TradingOrderOutputDto().setErrorMessage(message);
      }

      const leftAsset = rule.leftAsset;
      const rightAsset = rule.rightAsset;

      leftAsset.blockchain === rightAsset.blockchain ? rule.processing() : rule.deactivate();
      await this.ruleRepo.save(rule);

      if (!rule.isProcessing()) {
        throw new Error(
          `Blockchain mismatch: ${leftAsset.blockchain} and ${rightAsset.blockchain} in trading rule ${rule.id}`,
        );
      }

      const tradingService = this.tradingRegistryService.getService(leftAsset.blockchain);
      const tradingInfo = await tradingService.createTradingInfo(rule);

      if (tradingInfo.swap.amountIn) {
        const order = TradingOrder.create(rule, tradingInfo);

        return TradingOrderOutputDtoMapper.entityToDto(await this.orderRepo.save(order));
      }
    } catch (e) {
      const message = `Error processing trading rule ${rule.id}`;
      this.logger.error(message, e);
      return new TradingOrderOutputDto().setErrorMessage(message);
    }
  }
}
