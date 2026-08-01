import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { authEndpoints, type EndpointRequest } from "@unimailbox/contracts";
import { apiClient, setAccessToken } from "../../lib/api/index";

export const authKeys = {
  all: ["auth"] as const,
  session: () => [...authKeys.all, "session"] as const,
};

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: authKeys.session(),
    queryFn: () => apiClient.request(authEndpoints.session, {}),
    staleTime: 15_000,
    retry: false,
  });
}

export function loginMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (body: EndpointRequest<typeof authEndpoints.login>["body"]) =>
      apiClient.request(authEndpoints.login, { body }),
    retry: false,
    onSuccess: async (result) => {
      setAccessToken(result.accessToken);
      await queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}

export function logoutMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: () => apiClient.request(authEndpoints.logout, {}),
    retry: false,
    onSuccess: () => {
      setAccessToken(null);
      queryClient.clear();
    },
  });
}
