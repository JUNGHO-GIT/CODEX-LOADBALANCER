import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAccount, type CreateAccountPayload, SNAPSHOT_QUERY_KEY } from "@/features/dashboard/api";
import { useLoadBalancerSnapshot } from "@/features/dashboard/hooks/use-dashboard";

// 1. Accounts hook ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function useAccounts() {
  const snapshotQuery = useLoadBalancerSnapshot();
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: (payload: CreateAccountPayload) => createAccount(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
    },
  });

  return {
    snapshotQuery,
    createMutation,
  };
}
