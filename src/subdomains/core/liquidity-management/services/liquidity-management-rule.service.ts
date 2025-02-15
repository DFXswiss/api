import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, Not } from 'typeorm';
import { LiquidityManagementActionDto } from '../dto/input/liquidity-management-action.dto';
import { LiquidityManagementRuleCreationDto } from '../dto/input/liquidity-management-rule-creation.dto';
import { LiquidityManagementRuleSettingsDto } from '../dto/input/liquidity-management-settings.dto';
import { LiquidityManagementRuleUpdateDto } from '../dto/input/liquidity-management-update.dto';
import { LiquidityManagementRuleOutputDto } from '../dto/output/liquidity-management-rule-output.dto';
import { LiquidityManagementRuleOutputDtoMapper } from '../dto/output/mappers/liquidity-management-rule-output-dto.mapper';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementRuleStatus } from '../enums';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-action-integration.factory';
import { LiquidityManagementRuleFactory } from '../factories/liquidity-management-rule.factory';
import { LiquidityManagementActionRepository } from '../repositories/liquidity-management-action.repository';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';

@Injectable()
export class LiquidityManagementRuleService {
  private readonly logger = new DfxLogger(LiquidityManagementRuleService);

  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly actionRepo: LiquidityManagementActionRepository,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly actionIntegrationFactory: LiquidityActionIntegrationFactory,
    private readonly notificationService: NotificationService,
  ) {}

  //*** PUBLIC API ***//

  async createRule(dto: LiquidityManagementRuleCreationDto): Promise<LiquidityManagementRuleOutputDto> {
    const existingRule = await this.findExistingRuleOnCreation(dto);

    if (existingRule) {
      throw new BadRequestException(`Rule for specified asset/fiat already exists. Rule ID: ${existingRule.id}`);
    }

    const rule = await this.checkAndCreateInstance(dto);

    return LiquidityManagementRuleOutputDtoMapper.entityToDto(await this.ruleRepo.save(rule));
  }

  async updateRule(id: number, dto: LiquidityManagementRuleUpdateDto): Promise<void> {
    const existingRule = await this.ruleRepo.findOneBy({ id });

    if (!existingRule) throw new NotFoundException(`Rule ${id} was not found.`);
    if (existingRule.status === LiquidityManagementRuleStatus.PROCESSING) {
      throw new BadRequestException('Rule is currently processing and cannot be updated');
    }

    await this.ruleRepo.update(existingRule.id, dto);
  }

  async getRule(id: number): Promise<LiquidityManagementRuleOutputDto> {
    const rule = await this.ruleRepo.findOneBy({ id });

    if (!rule) throw new NotFoundException(`Rule ${id} not found.`);

    return LiquidityManagementRuleOutputDtoMapper.entityToDto(rule);
  }

  async deactivateRule(id: number): Promise<LiquidityManagementRuleOutputDto> {
    const rule = await this.ruleRepo.findOneBy({ id });

    if (!rule) throw new NotFoundException(`Rule ${id} was not found.`);

    rule.deactivate();

    return LiquidityManagementRuleOutputDtoMapper.entityToDto(await this.ruleRepo.save(rule));
  }

  async reactivateRule(id: number): Promise<LiquidityManagementRuleOutputDto> {
    const rule = await this.ruleRepo.findOneBy({ id });

    if (!rule) throw new NotFoundException(`Rule ${id} not found.`);

    rule.reactivate();

    return LiquidityManagementRuleOutputDtoMapper.entityToDto(await this.ruleRepo.save(rule));
  }

  async updateRuleSettings(
    id: number,
    dto: LiquidityManagementRuleSettingsDto,
  ): Promise<LiquidityManagementRuleOutputDto> {
    const rule = await this.ruleRepo.findOneBy({ id });

    if (!rule) throw new NotFoundException(`Rule ${id} not found.`);

    const { reactivationTime } = dto;

    rule.updateRuleSettings(reactivationTime);

    return LiquidityManagementRuleOutputDtoMapper.entityToDto(await this.ruleRepo.save(rule));
  }

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.LIQUIDITY_MANAGEMENT, timeout: 1800 })
  async reactivateRules(): Promise<void> {
    const rules = await this.ruleRepo.findBy({
      status: LiquidityManagementRuleStatus.PAUSED,
      reactivationTime: Not(IsNull()),
    });

    for (const rule of rules) {
      if (rule.shouldReactivate()) {
        rule.reactivate();
        await this.ruleRepo.save(rule);

        const mailRequest = this.generateRuleRetriedMessage(rule);

        if (rule.sendNotifications) await this.notificationService.sendMail(mailRequest);

        this.logger.info(`Reactivated liquidity management rule ${rule.id}`);
      }
    }
  }

  //*** HELPER METHODS ***//

  private async checkAndCreateInstance(dto: LiquidityManagementRuleCreationDto): Promise<LiquidityManagementRule> {
    const [targetAsset, targetFiat] = await this.checkTarget(dto);
    const [firstDeficitAction, firstRedundancyAction] = await this.checkAllActions(dto);

    return LiquidityManagementRuleFactory.create(
      dto,
      targetAsset,
      targetFiat,
      firstDeficitAction,
      firstRedundancyAction,
    );
  }

  private async findExistingRuleOnCreation(
    dto: LiquidityManagementRuleCreationDto,
  ): Promise<LiquidityManagementRule | undefined> {
    return this.ruleRepo.findOneBy([
      { targetAsset: { id: dto.targetAssetId } },
      { targetFiat: { id: dto.targetFiatId } },
    ]);
  }

  private async checkTarget(dto: LiquidityManagementRuleCreationDto): Promise<[Asset | null, Fiat | null]> {
    const { targetAssetId, targetFiatId } = dto;

    return [await this.checkTargetAsset(targetAssetId), await this.checkTargetFiat(targetFiatId)];
  }

  private async checkTargetAsset(targetAssetId: number): Promise<Asset | null> {
    if (!targetAssetId) return null;

    const targetAsset = await this.assetService.getAssetById(targetAssetId);

    if (!targetAsset) throw new BadRequestException(`Target asset with if ${targetAssetId} not found.`);

    return targetAsset;
  }

  private async checkTargetFiat(targetFiatId: number): Promise<Fiat | null> {
    if (!targetFiatId) return null;

    const targetFiat = await this.fiatService.getFiat(targetFiatId);

    if (!targetFiat) throw new BadRequestException(`Target fiat with if ${targetFiatId} not found.`);

    return targetFiat;
  }

  private async checkAllActions(
    dto: LiquidityManagementRuleCreationDto,
  ): Promise<[LiquidityManagementAction | null, LiquidityManagementAction | null]> {
    const { deficitActions, redundancyActions } = dto;

    return [await this.checkActions(deficitActions), await this.checkActions(redundancyActions)];
  }

  private async checkActions(actions: LiquidityManagementActionDto[]): Promise<LiquidityManagementAction | null> {
    if (!actions) return null;

    return this.confirmOrCreateActionTree(actions, 1);
  }

  private async confirmOrCreateActionTree(
    actionDtos: LiquidityManagementActionDto[],
    stepNumber: number,
  ): Promise<LiquidityManagementAction> {
    const actionDto = actionDtos.find((a) => a.stepNumber === stepNumber);

    if (!actionDto) throw new BadRequestException(`Could not find action with step ${stepNumber}`);

    let actionOnSuccess: LiquidityManagementAction | null = null;
    let actionOnFail: LiquidityManagementAction | null = null;

    if (actionDto.stepNumberOnSuccess) {
      actionOnSuccess = await this.confirmOrCreateActionTree(actionDtos, actionDto.stepNumberOnSuccess);
    }

    if (actionDto.stepNumberOnFail) {
      actionOnFail = await this.confirmOrCreateActionTree(actionDtos, actionDto.stepNumberOnFail);
    }

    return this.confirmOrCreateAction(actionDto, actionOnSuccess, actionOnFail);
  }

  private async confirmOrCreateAction(
    actionDto: LiquidityManagementActionDto,
    actionOnSuccess: LiquidityManagementAction | null,
    actionOnFail: LiquidityManagementAction | null,
  ): Promise<LiquidityManagementAction> {
    const existingAction = await this.findExistingAction(actionDto, actionOnSuccess, actionOnFail);

    if (existingAction) return existingAction;

    const newAction = LiquidityManagementAction.create(
      actionDto.system,
      actionDto.command,
      actionDto.params,
      actionOnSuccess,
      actionOnFail,
    );

    const integration = this.actionIntegrationFactory.getIntegration(newAction);

    if (!integration) {
      throw new BadRequestException(
        `No integration found for action. System: ${actionDto.system}, command: ${actionDto.command}`,
      );
    }

    const isParamsValid = integration.validateParams(actionDto.command, actionDto.params);

    if (!isParamsValid) {
      throw new BadRequestException(`Params provided with action are not valid. Command name: ${actionDto.command}`);
    }

    return this.actionRepo.save(newAction);
  }

  private async findExistingAction(
    actionDto: LiquidityManagementActionDto,
    onSuccess: LiquidityManagementAction | null,
    onFail: LiquidityManagementAction | null,
  ): Promise<LiquidityManagementAction | null> {
    const { system, command, params } = actionDto;

    return (
      this.actionRepo.findOne({
        where: {
          system,
          command,
          onSuccess: onSuccess ? { id: onSuccess.id } : IsNull(),
          onFail: onFail ? { id: onFail?.id } : IsNull(),
          params: params ? JSON.stringify(params) : IsNull(),
        },
        relations: ['onSuccess', 'onFail'],
      }) ?? null
    );
  }

  private generateRuleRetriedMessage(rule: LiquidityManagementRule): MailRequest {
    const message = `Liquidity management rule ${rule.id} reactivated after ${rule.reactivationTime} minutes`;

    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      context: MailContext.LIQUIDITY_MANAGEMENT,
      input: {
        subject: 'Liquidity management rule reactivated',
        errors: [message],
      },
    };

    return mailRequest;
  }
}
