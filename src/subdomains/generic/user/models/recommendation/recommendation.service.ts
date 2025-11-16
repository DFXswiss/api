import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';
import { KycType, UserDataStatus } from '../user-data/user-data.enum';
import { UserDataService } from '../user-data/user-data.service';
import { UserService } from '../user/user.service';
import {
  CreateRecommendationDto,
  CreateRecommendationInternalDto,
  UpdateRecommendationDto,
  UpdateRecommendationInternalDto,
} from './dto/recommendation.dto';
import { Recommendation, RecommendationCreator, RecommendationType } from './recommendation.entity';
import { RecommendationRepository } from './recommendation.repository';

@Injectable()
export class RecommendationService {
  private readonly logger = new DfxLogger(RecommendationService);

  constructor(
    private readonly recommendationRepo: RecommendationRepository,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => UserDataService))
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
  ) {}

  async createRecommendationByRecommender(userDataId: number, dto: CreateRecommendationDto): Promise<Recommendation> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData) throw new NotFoundException('Account not found');

    const recruit = dto.mail
      ? (await this.userDataService.getUsersByMail(dto.mail)?.[0]) ??
        (await this.userDataService.createUserData({
          mail: dto.mail,
          status: UserDataStatus.KYC_ONLY,
          kycType: KycType.DFX,
          language: userData.language,
          currency: userData.currency,
        }))
      : undefined;

    const entity = await this.createRecommendationInternal(
      RecommendationCreator.RECOMMENDER,
      RecommendationType.MAIL,
      dto.recommendedAlias,
      userData,
      recruit,
      undefined,
      dto.mail,
    );

    if (dto.mail) await this.sendRecommenderMail(entity);

    return entity;
  }

  async createRecommendationByRecommended(
    type: RecommendationType,
    recommendedAlias: string,
    creator: UserData,
    kycStep: KycStep,
    dto: CreateRecommendationInternalDto,
  ): Promise<Recommendation> {
    const advertiser = dto.refCode
      ? await this.userService.getRefUser(dto.refCode).then((u) => u.userData)
      : dto.mail
      ? await this.userDataService.getUsersByMail(dto.mail)?.[0]
      : undefined;

    const entity = await this.createRecommendationInternal(
      RecommendationCreator.RECOMMENDED,
      type,
      recommendedAlias,
      advertiser,
      creator,
      kycStep,
    );

    await this.sendPendingConfirmationMail(entity);

    return entity;
  }

  async createRecommendationInternal(
    creator: RecommendationCreator,
    type: RecommendationType,
    recommendedAlias: string,
    recommender: UserData,
    recommended?: UserData,
    kycStep?: KycStep,
    recommendedMail?: string,
  ): Promise<Recommendation> {
    const hash = Util.createHash(new Date().toISOString() + recommender.id).toUpperCase();

    const entity = this.recommendationRepo.create({
      kycStep,
      creator,
      type,
      recommendedAlias,
      recommendedMail,
      recommender,
      recommended,
      expirationDate: creator === RecommendationCreator.RECOMMENDER ? Util.daysAfter(7) : Util.daysAfter(30),
      code: `${hash.slice(0, 2)}-${hash.slice(2, 6)}-${hash.slice(6, 10)}-${hash.slice(10, 12)}`,
    });

    return this.recommendationRepo.save(entity);
  }

  async updateRecommendation(userDataId: number, id: number, dto: UpdateRecommendationDto): Promise<Recommendation> {
    const entity = await this.recommendationRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Recommendation not found');
    if (entity.recommender.id !== userDataId)
      throw new BadRequestException('You can not confirm a recommendation from another account');

    return this.updateRecommendationInternal(entity, { ...dto, confirmationDate: new Date() });
  }

  async updateRecommendationInternal(
    entity: Recommendation,
    dto: UpdateRecommendationInternalDto,
  ): Promise<Recommendation> {
    if (dto.recommended) {
      if (entity.recommender.id === dto.recommended.id)
        throw new Error('Recommender and recommended can not be the same account');

      if (entity.recommended.id) throw new Error('Recommended already set');

      entity.expirationDate = Util.daysAfter(30);
    }

    Object.assign(entity, dto);

    return this.recommendationRepo.save(entity);
  }

  async getAndCheckRecommendationByCode(code: string): Promise<Recommendation> {
    const entity = await this.recommendationRepo.findOne({
      where: { code },
      relations: { recommended: true, recommender: true },
    });
    if (!entity) throw new NotFoundException('Recommendation code not found');
    if (entity.isExpired) throw new BadRequestException('Recommendation code is expired');
    if (entity.isUsed) throw new BadRequestException('Recommendation code is already used');

    return entity;
  }

  async getAllRecommendationForUserData(userDataId: number, onlyUnconfirmed = false): Promise<Recommendation[]> {
    return this.recommendationRepo.find({
      where: { recommender: { id: userDataId }, isConfirmed: onlyUnconfirmed ? IsNull() : undefined },
      relations: { recommended: true, recommender: true },
    });
  }

  async getOwnRecommendationForUserData(userDataId: number): Promise<Recommendation[]> {
    return this.recommendationRepo.find({
      where: { recommended: { id: userDataId } },
      relations: { recommended: true, recommender: true },
    });
  }

  private async sendRecommenderMail(entity: Recommendation): Promise<void> {
    try {
      if (entity.recommended.mail) {
        await this.notificationService.sendMail({
          type: MailType.USER_V2,
          context: MailContext.RECOMMENDER_MAIL,
          input: {
            userData: entity.recommended,
            wallet: entity.recommended.wallet,
            title: `${MailTranslationKey.RECOMMENDATION_RECOMMENDED}.title`,
            salutation: { key: `${MailTranslationKey.RECOMMENDATION_RECOMMENDED}.salutation` },
            texts: [
              { key: MailKey.SPACE, params: { value: '3' } },
              {
                key: `${MailTranslationKey.GENERAL}.welcome`,
                params: { name: entity.recommendedAlias },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_RECOMMENDED}.message`,
                params: { name: entity.recommender.completeName, mail: entity.recommender.mail },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_RECOMMENDED}.registration_button`,
                params: { url: entity.url, button: 'true' },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_RECOMMENDED}.registration_link`,
                params: { url: entity.url, urlText: entity.url },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
      } else {
        this.logger.warn(`Failed to send recommendation (${entity.id}) recommender mail: user has no email`);
      }
    } catch (e) {
      this.logger.error(`Failed to send recommendation (${entity.id}) recommender mail:`, e);
    }
  }

  private async sendPendingConfirmationMail(entity: Recommendation): Promise<void> {
    try {
      if (entity.recommender.mail) {
        await this.notificationService.sendMail({
          type: MailType.USER_V2,
          context: MailContext.RECOMMENDATION_CONFIRMATION_MAIL,
          input: {
            userData: entity.recommender,
            wallet: entity.recommender.wallet,
            title: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.title`,
            salutation: { key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.salutation` },
            texts: [
              { key: MailKey.SPACE, params: { value: '3' } },
              {
                key: `${MailTranslationKey.GENERAL}.welcome`,
                params: { name: entity.recommender.firstname },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.message`,
                params: { name: entity.recommended.completeName, mail: entity.recommended.mail },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.button`,
                params: { url: entity.url, button: 'true' },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.link`,
                params: { url: entity.url, urlText: entity.url },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
      } else {
        this.logger.warn(`Failed to send recommendation (${entity.id}) confirmation mail: user has no email`);
      }
    } catch (e) {
      this.logger.error(`Failed to send recommendation (${entity.id}) confirmation mail:`, e);
    }
  }
}
