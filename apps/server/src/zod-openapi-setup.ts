/** 必须在 core 的 zod schema 被求值之前执行（api-schemas 首行 side-effect import） */
import { z } from "zod";
import { extendZodWithOpenApi } from "@hono/zod-openapi";

extendZodWithOpenApi(z);

export {};
