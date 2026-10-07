import type { PaymentItem } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export type PaymentBody = Record<string, unknown>;

export async function fetchPayments(): Promise<PaymentItem[]> {
  const { data } = await adminHttp.get<PaymentItem[]>("/payments");
  return data;
}

export async function createPayment(body: PaymentBody): Promise<PaymentItem> {
  const { data } = await adminHttp.post<PaymentItem>("/payments", body);
  return data;
}

export async function updatePayment(
  id: number,
  body: PaymentBody,
): Promise<PaymentItem> {
  const { data } = await adminHttp.put<PaymentItem>(`/payments/${id}`, body);
  return data;
}

export async function deletePayment(id: number): Promise<void> {
  await adminHttp.delete(`/payments/${id}`);
}
