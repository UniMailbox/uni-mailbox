export const SETUP_STORAGE_KEY = "cf-startup.initialSetup";
export const API_BASE_URL_STORAGE_KEY = "cf-startup.apiBaseUrl";

export const setupTaskIds = [
  "cloudflareResources",
  "wranglerBindings",
  "githubSettings",
  "d1Migrations",
  "firstDeploy"
] as const;

export type SetupTaskId = (typeof setupTaskIds)[number];

export type SetupState = {
  apiBaseUrl: string;
  pagesProjectName: string;
  d1DatabaseName: string;
  kvNamespaceId: string;
  r2BucketName: string;
  completed: Record<SetupTaskId, boolean>;
};

export const defaultSetupState: SetupState = {
  apiBaseUrl: "http://127.0.0.1:8787",
  pagesProjectName: "",
  d1DatabaseName: "cf-startup-db",
  kvNamespaceId: "",
  r2BucketName: "cf-startup-files",
  completed: {
    cloudflareResources: false,
    wranglerBindings: false,
    githubSettings: false,
    d1Migrations: false,
    firstDeploy: false
  }
};

export function setupCompletionPercentage(state: SetupState): number {
  const completedCount = setupTaskIds.filter((taskId) => state.completed[taskId]).length;
  return Math.round((completedCount / setupTaskIds.length) * 100);
}

export function loadSetupState(storage: Storage = window.localStorage): SetupState {
  const raw = storage.getItem(SETUP_STORAGE_KEY);

  if (!raw) {
    return defaultSetupState;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SetupState>;
    return {
      ...defaultSetupState,
      ...parsed,
      completed: {
        ...defaultSetupState.completed,
        ...parsed.completed
      }
    };
  } catch {
    return defaultSetupState;
  }
}

export function saveSetupState(state: SetupState, storage: Storage = window.localStorage): void {
  storage.setItem(SETUP_STORAGE_KEY, JSON.stringify(state));
  storage.setItem(API_BASE_URL_STORAGE_KEY, state.apiBaseUrl);
}
