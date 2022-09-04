import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { MasternodeRepository } from 'src/payment/models/masternode/masternode.repository';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { IsNull, LessThan, MoreThan, Not } from 'typeorm';
import { CreateMasternodeDto } from './dto/create-masternode.dto';
import { ResignMasternodeDto } from './dto/resign-masternode.dto';
import { Masternode } from './masternode.entity';

@Injectable()
export class MasternodeService {
  constructor(
    private readonly masternodeRepo: MasternodeRepository,
    private readonly http: HttpService,
    private readonly settingService: SettingService,
  ) {}

  // --- MASTERNODE SYNC --- //
  @Interval(1440000)
  async syncMasternodes(): Promise<void> {
    if (!Config.mydefichain.username) return;

    const dbOperatorList = await this.masternodeRepo.find({
      select: ['operator'],
    });
    const serverList = await this.settingService.get('serverList');
    
    for (const server of serverList.split(',')) {
      const operators = await this.callApi<string[]>(`http://${server}.mydefichain.com/api/operatoraddresses`, 'GET');
      const missingOperators = operators.filter(
        (item) => dbOperatorList.map((masternode) => masternode.operator).indexOf(item) < 0,
      );

      for (const operator of missingOperators) {
        const newOperator = await this.masternodeRepo.create({ operator, server });
        await this.masternodeRepo.save(newOperator);
      }
    }
  }

  async get(): Promise<Masternode[]> {
    return this.masternodeRepo.find();
  }

  async create(id: number, dto: CreateMasternodeDto): Promise<Masternode> {
    const masternode = await this.masternodeRepo.findOne(id);
    if (!masternode) throw new NotFoundException('Masternode not found');
    if (masternode.creationHash) throw new ConflictException('Masternode already created');

    return await this.masternodeRepo.save({ ...masternode, ...dto });
  }

  async resign(id: number, dto: ResignMasternodeDto): Promise<Masternode> {
    const masternode = await this.masternodeRepo.findOne(id);
    if (!masternode) throw new NotFoundException('Masternode not found');
    if (!masternode.creationHash) throw new ConflictException('Masternode not yet created');
    if (masternode.resignHash) throw new ConflictException('Masternode already resigned');

    return await this.masternodeRepo.save({ ...masternode, ...dto });
  }

  async getActiveCount(date: Date = new Date()): Promise<number> {
    return this.masternodeRepo.count({
      where: [
        { creationDate: LessThan(date), resignDate: IsNull() },
        { creationDate: LessThan(date), resignDate: MoreThan(date) },
      ],
    });
  }

  async getActive(): Promise<Masternode[]> {
    return this.masternodeRepo.find({ where: { creationHash: Not(IsNull()), resignHash: IsNull() } });
  }

  // --- HELPER METHODS --- //

  private async callApi<T>(url: string, method: Method = 'GET', data?: any): Promise<T> {
    return this.request<T>(url, method, data).catch((e: HttpError) => {
      throw new ServiceUnavailableException(e);
    });
  }

  private async request<T>(url: string, method: Method, data?: any, nthTry = 3): Promise<T> {
    try {
      return await this.http.request<T>({
        url,
        method: method,
        data: method !== 'GET' ? data : undefined,
        auth: { username: Config.mydefichain.username, password: Config.mydefichain.password },
        params: method === 'GET' ? data : undefined,
      });
    } catch (e) {
      if (nthTry > 1 && e.response?.status == 401) {
        return this.request(url, method, data, nthTry - 1);
      }
      throw e;
    }
  }
}
