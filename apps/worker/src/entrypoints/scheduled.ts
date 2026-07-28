import { createAppContext } from "../app-context";
import { runScheduledTasks } from "../modules/maintenance/scheduled";
import type { Env } from "../platform/config";

export async function handleScheduledTask(
  controller: ScheduledController,
  env: Env,
  context: ExecutionContext,
): Promise<void> {
  const appContext = await createAppContext(env, context);
  await runScheduledTasks(appContext, controller.scheduledTime);
}
