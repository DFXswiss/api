export interface ScanApiResponse<T> {
  status: '0' | '1';
  message: string;
  result: T | string;
}
