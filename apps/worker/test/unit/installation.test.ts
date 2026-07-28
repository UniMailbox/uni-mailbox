import { describe, expect, it } from "vitest";
import { InstallationStep } from "@unimailbox/contracts";
import { InstallationService } from "../../src/modules/installation";

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
    };
    const service = new InstallationService(repository);
    await expect(service.getStatus()).resolves.toBe(expected);
  });
});
