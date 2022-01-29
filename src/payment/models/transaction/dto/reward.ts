export class Reward {
  value: number;
  category: string;
  date: string;
  detail: {
    token: string;
    qty: number;
    pool: string;
  }
}
