import type { Env } from "../platform/config";
import { createAppContext } from "../app-context";
import { InboundMailService } from "../modules/inbound-mail";

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
  context: ExecutionContext,
): Promise<void> {
  const appContext = await createAppContext(env, context);
  await new InboundMailService(appContext).receive(message);
}
