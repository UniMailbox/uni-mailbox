import { beforeEach, describe, expect, it } from "vitest";
import {
  API_BASE_URL_STORAGE_KEY,
  defaultSetupState,
  loadSetupState,
  saveSetupState,
  setupCompletionPercentage
} from "./setup";

describe("setup state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("calculates setup completion from task state", () => {
    expect(
      setupCompletionPercentage({
        ...defaultSetupState,
        completed: {
          ...defaultSetupState.completed,
          cloudflareResources: true,
          wranglerBindings: true
        }
      })
    ).toBe(40);
  });

  it("falls back to defaults when stored setup is invalid", () => {
    const storage = window.localStorage;
    storage.setItem("cf-startup.initialSetup", "{bad json");

    expect(loadSetupState(storage)).toEqual(defaultSetupState);
  });

  it("persists api base url separately for api requests", () => {
    const storage = window.localStorage;
    saveSetupState(
      {
        ...defaultSetupState,
        apiBaseUrl: "https://api.example.com"
      },
      storage
    );

    expect(storage.getItem(API_BASE_URL_STORAGE_KEY)).toBe("https://api.example.com");
  });
});
