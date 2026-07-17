import type { Principal } from "@cf-startup/shared";

export type Env = {
  Bindings: {
    DB: D1Database;
    APP_KV: KVNamespace;
    FILE_BUCKET: R2Bucket;
    APP_ENV: string;
    ALLOWED_ORIGIN: string;
  };
  Variables: {
    principal: Principal;
  };
};
