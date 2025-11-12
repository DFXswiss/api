import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UserData } from '../user-data/user-data.entity';
import { UserDataService } from '../user-data/user-data.service';
import { UserService } from '../user/user.service';
import {
  CreateRecommendationInternalDto,
  UpdateRecommendationDto,
  UpdateRecommendationInternalDto,
} from './dto/recommendation.dto';
import { Recommendation, RecommendationCreator, RecommendationType } from './recommendation.entity';
import { RecommendationRepository } from './recommendation.repository';

@Injectable()
export class RecommendationService {
  constructor(
    private readonly recommendationRepo: RecommendationRepository,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => UserDataService))
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
  ) {}

  async createRecommendationByAdvertiser(
    type: RecommendationType,
    label: string,
    creator: UserData,
    dto: CreateRecommendationInternalDto,
  ): Promise<Recommendation> {
    const recruit = dto.mail ? await this.userDataService.getUsersByMail(dto.mail)?.[0] : undefined;

    return this.createRecommendationInternal(RecommendationCreator.RECOMMENDER, type, label, creator, recruit);
  }

  async createRecommendationByRecruit(
    type: RecommendationType,
    label: string,
    creator: UserData,
    dto: CreateRecommendationInternalDto,
  ): Promise<Recommendation> {
    const advertiser = dto.refCode
      ? await this.userService.getRefUser(dto.refCode).then((u) => u.userData)
      : dto.mail
      ? await this.userDataService.getUsersByMail(dto.mail)?.[0]
      : undefined;

    return this.createRecommendationInternal(RecommendationCreator.RECOMMENDED, type, label, advertiser, creator);
  }

  async createRecommendationInternal(
    creator: RecommendationCreator,
    type: RecommendationType,
    label: string,
    recommender: UserData,
    recommended?: UserData,
  ): Promise<Recommendation> {
    const entity = this.recommendationRepo.create({
      creator,
      type,
      label,
      recommender,
      recommended,
      expiration: Util.daysAfter(7),
      code: randomUUID(),
    });

    return this.recommendationRepo.save(entity);
  }

  async updateRecommendation(id: number, dto: UpdateRecommendationDto): Promise<Recommendation> {
    const entity = await this.recommendationRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Recommendation not found');

    return this.updateRecommendationInternal(entity, dto);
  }

  async updateRecommendationInternal(
    entity: Recommendation,
    dto: UpdateRecommendationInternalDto,
  ): Promise<Recommendation> {
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
}
