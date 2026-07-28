import {
  DomainError,
  type InstallationStatus,
  type InstallationStep,
} from "@unimailbox/contracts";

export interface InstallationRepository {
  getStatus(): Promise<InstallationStatus>;
  requireCurrent(step: InstallationStep): Promise<InstallationStatus>;
  advanceCompareAndSet(input: {
    stateVersion: number;
    completedStep: InstallationStep;
    nextStep: InstallationStep;
    requestId: string;
  }): Promise<InstallationStatus>;
}

export class InstallationService {
  constructor(private readonly installation: InstallationRepository) {}

  getStatus(): Promise<InstallationStatus> {
    return this.installation.getStatus();
  }

  async advance(input: {
    expected: InstallationStep;
    next: InstallationStep;
    requestId: string;
    verify: () => Promise<void>;
  }): Promise<InstallationStatus> {
    const state = await this.installation.requireCurrent(input.expected);
    await input.verify();
    return this.installation.advanceCompareAndSet({
      stateVersion: state.stateVersion,
      completedStep: input.expected,
      nextStep: input.next,
      requestId: input.requestId,
    });
  }
}

export function assertInstallationTransition(
  actual: InstallationStep,
  expected: InstallationStep,
): void {
  if (actual !== expected) {
    throw new DomainError(
      "INSTALLATION_STEP_CONFLICT",
      `Expected setup step ${expected}, received ${actual}`,
      409,
    );
  }
}
