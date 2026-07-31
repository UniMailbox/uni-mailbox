import type { Principal } from "@unimailbox/contracts";
import type { Env } from "../platform/config";
import type { HttpAppContext } from "./router";

export interface HttpAppBindings {
  Bindings: Env;
  Variables: {
    appContext: HttpAppContext;
    requestId: string;
    principal: Principal;
  };
}
