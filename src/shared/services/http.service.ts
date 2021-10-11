import { HttpService as Http } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';

export interface HttpError {
  response?: {
    status?: number;
    data?: any;
  };
}

@Injectable()
export class HttpService {
  constructor(private http: Http) {}

  public async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return (await firstValueFrom(this.http.get<T>(url, config))).data;
  }

  public async put<T>(url: string, data: any, config?: AxiosRequestConfig): Promise<T> {
    return (await firstValueFrom(this.http.put<T>(url, data, config))).data;
  }

  public async post<T>(url: string, data: any, config?: AxiosRequestConfig): Promise<T> {
    return (await firstValueFrom(this.http.post<T>(url, data, config))).data;
  }

  public async patch<T>(url: string, data: any, config?: AxiosRequestConfig): Promise<T> {
    return (await firstValueFrom(this.http.patch<T>(url, data, config))).data;
  }

  public async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return (await firstValueFrom(this.http.delete<T>(url, config))).data;
  }

  public async request<T>(config: AxiosRequestConfig): Promise<T> {
    return (await firstValueFrom(this.http.request<T>(config))).data;
  }
}
