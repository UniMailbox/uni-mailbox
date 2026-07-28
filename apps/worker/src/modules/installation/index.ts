import type { InstallationStatus } from "@unimailbox/contracts";

export interface InstallationRepository {
  getStatus(): Promise<InstallationStatus>;
}

export class InstallationService {
  constructor(private readonly installation: InstallationRepository) {}

  getStatus(): Promise<InstallationStatus> {
    return this.installation.getStatus();
  }
}
