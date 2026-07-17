import { useEffect, useState } from "react";
import { loadSetupState, saveSetupState, type SetupState } from "../setup";

export function useSetupState() {
  const [setup, setSetup] = useState<SetupState>(() => loadSetupState());

  useEffect(() => {
    saveSetupState(setup);
  }, [setup]);

  return [setup, setSetup] as const;
}
