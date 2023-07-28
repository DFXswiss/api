export type ScanApiResponse<T> =
  | {
      status: '0';
      message: string;
      result: string;
    }
  | {
      status: '1';
      message: string;
      result: T;
    };
