import { describe, expect, it } from "vitest";
import { InstallationStep } from "@unimailbox/contracts";
import {
  InstallationService,
  assertInstallationTransition,
} from "../../src/modules/installation";

describe("assertInstallationTransition", () => {
  it("does nothing when the actual step matches the expected step", () => {
    expect(() =>
      assertInstallationTransition(
        InstallationStep.PREFLIGHT,
        InstallationStep.PREFLIGHT,
      ),
    ).not.toThrow();
  });

  it("throws a 409 conflict when the steps differ", () => {
    expect(() =>
      assertInstallationTransition(
        InstallationStep.PREFLIGHT,
        InstallationStep.ADMIN,
      ),
    ).toThrowError(/Expected setup step admin, received preflight/u);
  });
});

describe("InstallationService.getStatus", () => {
  it("delegates to the repository", async () => {
    const expected = {
      installationVersion: 3,
      stateVersion: 4,
      currentStep: InstallationStep.COMPLETE,
      completedSteps: [],
    };
    const repository = {
      getStatus: async () => expected,
      requireCurrent: async () => expected,
      advanceCompareAndSet: async () => expected,
    };
    const service = new InstallationService(repository);
    await expect(service.getStatus()).resolves.toBe(expected);
  });
});
