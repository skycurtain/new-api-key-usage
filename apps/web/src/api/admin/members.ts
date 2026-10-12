import type { MemberItem } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export type MemberWithToken = {
  member: MemberItem;
  token: string;
};

export async function fetchMembers(): Promise<MemberItem[]> {
  const { data } = await adminHttp.get<MemberItem[]>("/members");
  return data;
}

/** 开户：响应含令牌明文（仅此一次） */
export async function createMember(body: {
  name: string;
  remark?: string;
}): Promise<MemberWithToken> {
  const { data } = await adminHttp.post<MemberWithToken>("/members", body);
  return data;
}

export async function patchMember(
  id: number,
  body: {
    name?: string;
    remark?: string;
    status?: "active" | "disabled";
  },
): Promise<MemberItem> {
  const { data } = await adminHttp.patch<MemberItem>(`/members/${id}`, body);
  return data;
}

/** 空壳删除：仅 key_count = 0 */
export async function deleteMember(id: number): Promise<void> {
  await adminHttp.delete(`/members/${id}`);
}

/** 重发：旧令牌即刻失效，明文仅此一次 */
export async function issueMemberToken(id: number): Promise<{ token: string }> {
  const { data } = await adminHttp.post<{ token: string }>(`/members/${id}/token`);
  return data;
}
