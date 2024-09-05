import { HttpService as Http } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { createWriteStream } from 'fs';
import { firstValueFrom } from 'rxjs';
import { Util } from '../utils/util';

export interface HttpError {
  response?: {
    status?: number;
    data?: any;
  };
}

export type HttpRequestConfig = AxiosRequestConfig & { tryCount?: number; retryDelay?: number };

@Injectable()
export class HttpService {
  constructor(private readonly http: Http) {}

  public async get<T>(url: string, config?: HttpRequestConfig): Promise<T> {
    return (await this.getRaw<T>(url, config)).data;
  }

  public async getRaw<T>(url: string, config?: HttpRequestConfig): Promise<AxiosResponse<T>> {
    return Util.retry(() => firstValueFrom(this.http.get<T>(url, config)), config?.tryCount ?? 1, config?.retryDelay);
  }

  public async put<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    return (
      await Util.retry(
        () => firstValueFrom(this.http.put<T>(url, data, config)),
        config?.tryCount ?? 1,
        config?.retryDelay,
      )
    ).data;
  }

  public async post<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    return (
      await Util.retry(
        () => firstValueFrom(this.http.post<T>(url, data, config)),
        config?.tryCount ?? 1,
        config?.retryDelay,
      )
    ).data;
  }

  public async patch<T>(url: string, data: any, config?: HttpRequestConfig): Promise<T> {
    return (
      await Util.retry(
        () => firstValueFrom(this.http.patch<T>(url, data, config)),
        config?.tryCount ?? 1,
        config?.retryDelay,
      )
    ).data;
  }

  public async delete<T>(url: string, config?: HttpRequestConfig): Promise<T> {
    return (
      await Util.retry(
        () => firstValueFrom(this.http.delete<T>(url, config)),
        config?.tryCount ?? 1,
        config?.retryDelay,
      )
    ).data;
  }

  public async request<T>(config: HttpRequestConfig): Promise<T> {
    return (
      await Util.retry(() => firstValueFrom(this.http.request<T>(config)), config?.tryCount ?? 1, config?.retryDelay)
    ).data;
  }

  async downloadFile(fileUrl: string, filePath: string) {
    const stream = await this.http.axiosRef.request({ method: 'GET', url: fileUrl, responseType: 'stream' });
    const writer = createWriteStream(filePath);

    return new Promise((resolve, reject) => {
      stream.data.pipe(writer);

      let error = null;

      writer.on('error', (err) => {
        error = err;
        writer.close();
        reject(err);
      });

      writer.on('close', () => !error && resolve(true));
    });
  }
}
