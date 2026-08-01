import { afterEach, describe, expect, it } from "vitest";
import { getAccessToken, setAccessToken } from "./index";

describe("configured API token storage", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("exposes the configured transport token accessors without the deprecated API module", () => {
    setAccessToken("access-token");

    expect(getAccessToken()).toBe("access-token");
    expect(window.localStorage.getItem("unimailbox.access-token")).toBeNull();

    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});
