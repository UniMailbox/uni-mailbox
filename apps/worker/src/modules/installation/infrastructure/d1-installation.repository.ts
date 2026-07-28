import {
  DomainError,
  type InstallationStatus,
  type InstallationStep,
} from "@unimailbox/contracts";
import type { InstallationRepository } from "../index";

interface InstallationRow {
  installation_version: number;
  state_version: number;
  current_step: InstallationStep;
  completed_steps_json: string;
}

function toStatus(row: InstallationRow): InstallationStatus {
  const completed = JSON.parse(row.completed_steps_json) as unknown;
  return {
    installationVersion: row.installation_version,
    stateVersion: row.state_version,
    currentStep: row.current_step,
    completedSteps: Array.isArray(completed)
      ? completed.filter((value): value is string => typeof value === "string")
      : [],
  };
}

export class D1InstallationRepository implements InstallationRepository {
  constructor(private readonly database: D1Database) {}

  async getStatus(): Promise<InstallationStatus> {
    const row = await this.database
      .prepare(
        `SELECT installation_version, state_version, current_step,
                completed_steps_json
         FROM installation_state
         WHERE id = 1`,
      )
      .first<InstallationRow>();
    if (!row) {
      throw new DomainError(
        "INSTALLATION_STATE_MISSING",
        "The installation schema has not been migrated",
        503,
      );
    }
    return toStatus(row);
  }
}
