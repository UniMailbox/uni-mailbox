import {
  DomainError,
  type InstallationStatus,
  type InstallationStep,
} from "@unimailbox/contracts";
import {
  assertInstallationTransition,
  type InstallationRepository,
} from "../index";

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

  async requireCurrent(step: InstallationStep): Promise<InstallationStatus> {
    const status = await this.getStatus();
    assertInstallationTransition(status.currentStep, step);
    return status;
  }

  async advanceCompareAndSet(input: {
    stateVersion: number;
    completedStep: InstallationStep;
    nextStep: InstallationStep;
    requestId: string;
  }): Promise<InstallationStatus> {
    const status = await this.getStatus();
    assertInstallationTransition(status.currentStep, input.completedStep);
    const completed = [
      ...new Set([...status.completedSteps, input.completedStep]),
    ];
    const result = await this.database
      .prepare(
        `UPDATE installation_state
         SET state_version = state_version + 1,
             status = CASE WHEN ? = 'complete' THEN 'complete' ELSE 'in_progress' END,
             current_step = ?,
             completed_steps_json = ?,
             completed_at = CASE WHEN ? = 'complete' THEN CURRENT_TIMESTAMP ELSE completed_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1
           AND state_version = ?
           AND current_step = ?`,
      )
      .bind(
        input.nextStep,
        input.nextStep,
        JSON.stringify(completed),
        input.nextStep,
        input.stateVersion,
        input.completedStep,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new DomainError(
        "INSTALLATION_STATE_CONFLICT",
        "The installation was advanced by another session",
        409,
      );
    }
    await this.database
      .prepare(
        `INSERT INTO audit_events (
           id, action, resource_type, resource_id, request_id, metadata_json
         ) VALUES (?, 'installation.step.completed', 'installation', '1', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.requestId,
        JSON.stringify({
          completedStep: input.completedStep,
          nextStep: input.nextStep,
        }),
      )
      .run();
    return this.getStatus();
  }
}
