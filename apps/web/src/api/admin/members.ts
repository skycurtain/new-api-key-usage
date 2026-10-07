import type { MemberItem } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export async function fetchMembers(): Promise<MemberItem[]> {
  const { data } = await adminHttp.get<MemberItem[]>("/members");
  return data;
}

export async function createMember(body: {
  name: string;
  remark?: string;
}): Promise<MemberItem> {
  const { data } = await adminHttp.post<MemberItem>("/members", body);
  return data;
}

export async function patchMember(
  id: number,
  body: { status: "active" | "disabled" },
): Promise<MemberItem> {
  const { data } = await adminHttp.patch<MemberItem>(`/members/${id}`, body);
  return data;
}

export async function issueMemberToken(id: number): Promise<{ token: string }> {
  const { data } = await adminHttp.post<{ token: string }>(`/members/${id}/token`);
  return data;
}
