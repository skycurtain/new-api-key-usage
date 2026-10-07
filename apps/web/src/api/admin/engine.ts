import type { EngineStatus, QpuLatest } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export async function fetchEngine(): Promise<EngineStatus> {
  const { data } = await adminHttp.get<EngineStatus>("/engine");
  return data;
}

export async function fetchQpuLatest(): Promise<QpuLatest> {
  const { data } = await adminHttp.get<QpuLatest>("/qpu/latest");
  return data;
}
