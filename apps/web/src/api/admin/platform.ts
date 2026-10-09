import { adminHttp } from "../http.ts";

export type PlatformSubscription = {
  id: number;
  plan_id: number;
  start_time: number;
  end_time: number;
  status: string;
  amount_total: number;
  amount_used: number;
};

export type PlatformTopup = {
  id: number;
  amount: number;
  money: number;
  trade_no?: string;
  payment_method?: string;
  payment_provider?: string;
  create_time?: number;
  complete_time?: number;
  status?: string;
};

export type PlatformLoginResult = { access_token: string };

/** 登录控制台（密码不落库）；token 由调用方短暂保存 */
export async function loginPlatform(body: {
  username: string;
  password: string;
}): Promise<PlatformLoginResult> {
  const { data } = await adminHttp.post<PlatformLoginResult>(
    "/platform/login",
    body,
  );
  return data;
}

export async function listPlatformSubscriptions(
  accessToken: string,
): Promise<PlatformSubscription[]> {
  const { data } = await adminHttp.post<{ subscriptions: PlatformSubscription[] }>(
    "/platform/subscriptions",
    { access_token: accessToken },
  );
  return data.subscriptions;
}

export async function listPlatformTopups(
  accessToken: string,
  page = 1,
  pageSize = 10,
): Promise<{
  items: PlatformTopup[];
  total: number;
  page: number;
  page_size: number;
}> {
  const { data } = await adminHttp.post<{
    items: PlatformTopup[];
    total: number;
    page: number;
    page_size: number;
  }>("/platform/topups", {
    access_token: accessToken,
    page,
    page_size: pageSize,
  });
  return data;
}
