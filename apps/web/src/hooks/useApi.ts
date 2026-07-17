import type { ApiFailure, ApiResult } from "@cf-startup/shared";
import { useCallback, useState } from "react";

type AsyncState<T> = {
  data: T | null;
  error: ApiFailure["error"] | null;
  loading: boolean;
};

export function useApi<T>() {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    loading: false
  });

  const run = useCallback(async (request: () => Promise<ApiResult<T>>) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    const result = await request();

    if (result.ok) {
      setState({ data: result.data, error: null, loading: false });
      return result.data;
    }

    setState({ data: null, error: result.error, loading: false });
    return null;
  }, []);

  return { ...state, run };
}
