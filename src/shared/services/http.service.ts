import { HttpService as Http } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Util } from '../util';

export interface HttpError {
  response?: {
    status?: number;
    data?: any;
  };
}

export type HttpRequestConfig = AxiosRequestConfig & { tryCount?: number };

@Injectable()
export class HttpService {
  constructor(private readonly http: Http) {}

  public async get<T>(url: string, config?: HttpRequestConfig): Promise<T> {
    return (await this.getRaw<T>(url, config)).data;
  }

  public async getRaw<T>(url: string, config?: HttpRequestConfig): Promise<AxiosResponse<T>> {
    return await Util.retry(() => firstValueFrom(this.http.get<T>(url, config)), config?.tryCount ?? 1);
  }

  public async put<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    return (await Util.retry(() => firstValueFrom(this.http.put<T>(url, data, config)), config?.tryCount ?? 1)).data;
  }

  public async post<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    return (await Util.retry(() => firstValueFrom(this.http.post<T>(url, data, config)), config?.tryCount ?? 1)).data;
  }

  public async patch<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    return (await Util.retry(() => firstValueFrom(this.http.patch<T>(url, data, config)), config?.tryCount ?? 1)).data;
  }

  public async delete<T>(url: string, config?: HttpRequestConfig): Promise<T> {
    return (await Util.retry(() => firstValueFrom(this.http.delete<T>(url, config)), config?.tryCount ?? 1)).data;
  }

  public async request<T>(config: HttpRequestConfig): Promise<T> {
    return (await Util.retry(() => firstValueFrom(this.http.request<T>(config)), config?.tryCount ?? 1)).data;
  }
}
