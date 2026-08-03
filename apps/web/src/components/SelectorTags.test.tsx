import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SelectorTags } from "./SelectorTags";

const options = [
  { value: "role-admin-id", label: "Administrators" },
  { value: "role-audit-id", label: "Auditors" },
];

function Harness({ initial = [] }: { initial?: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <SelectorTags
      ariaLabel="Selected roles"
      clearLabel="Clear all"
      emptyLabel="No roles assigned"
      loadingLabel="Loading roles…"
      noResultsLabel="No roles found"
      onChange={setValue}
      options={options}
      placeholder="Select roles"
      removeLabel={(label) => `Remove ${label}`}
      searchLabel="Search roles"
      value={value}
    />
  );
}

describe("SelectorTags", () => {
  it("searches and selects by display name without showing raw IDs", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Select roles" }));
    fireEvent.change(screen.getByPlaceholderText("Search roles"), {
      target: { value: "audit" },
    });
    expect(screen.queryByText("Administrators")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Auditors" }));
    expect(
      screen.getByRole("button", { name: "Remove Auditors" }),
    ).toBeVisible();
    expect(screen.queryByText("role-audit-id")).not.toBeInTheDocument();
  });

  it("removes one selected tag and clears all selected tags", () => {
    render(<Harness initial={["role-admin-id", "role-audit-id"]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Administrators" }),
    );
    expect(screen.queryByText("Administrators")).not.toBeInTheDocument();
    expect(screen.getByText("Auditors")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByText("No roles assigned")).toBeVisible();
  });

  it("renders only resolved async preselection labels", () => {
    const { rerender } = render(
      <SelectorTags
        ariaLabel="Selected roles"
        clearLabel="Clear all"
        emptyLabel="No roles assigned"
        loading
        loadingLabel="Loading roles…"
        noResultsLabel="No roles found"
        onChange={() => undefined}
        options={[]}
        placeholder="Select roles"
        removeLabel={(label) => `Remove ${label}`}
        searchLabel="Search roles"
        value={["role-admin-id"]}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Loading roles…" }),
    ).toBeDisabled();
    expect(screen.queryByText("role-admin-id")).not.toBeInTheDocument();
    rerender(
      <SelectorTags
        ariaLabel="Selected roles"
        clearLabel="Clear all"
        emptyLabel="No roles assigned"
        loadingLabel="Loading roles…"
        noResultsLabel="No roles found"
        onChange={() => undefined}
        options={options}
        placeholder="Select roles"
        removeLabel={(label) => `Remove ${label}`}
        searchLabel="Search roles"
        value={["role-admin-id"]}
      />,
    );
    expect(screen.getByText("Administrators")).toBeVisible();
  });
});
