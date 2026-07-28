import { createAppContext } from "../app-context";
import { createHttpApp } from "../http/router";
import type { Env } from "../platform/config";

export const httpApp = createHttpApp(createAppContext);

export const handleHttpRequest: ExportedHandlerFetchHandler<Env> = (
  request,
  env,
  context,
) => httpApp.fetch(request, env, context);
