import { adminHttp } from "../http.ts";

export type SetupState = { initialized: boolean };
export type UsernameBody = { username: string };

export async function fetchSetupState(): Promise<SetupState> {
  const { data } = await adminHttp.get<SetupState>("/setup-state");
  return data;
}

export async function setup(body: {
  username: string;
  password: string;
}): Promise<UsernameBody> {
  const { data } = await adminHttp.post<UsernameBody>("/setup", body);
  return data;
}

export async function login(body: {
  username: string;
  password: string;
}): Promise<UsernameBody> {
  const { data } = await adminHttp.post<UsernameBody>("/session", body);
  return data;
}

export async function fetchSession(): Promise<UsernameBody> {
  const { data } = await adminHttp.get<UsernameBody>("/session");
  return data;
}

export async function logout(): Promise<void> {
  await adminHttp.delete("/session");
}

export async function changePassword(body: {
  old_password: string;
  new_password: string;
}): Promise<void> {
  await adminHttp.put("/password", body);
}
