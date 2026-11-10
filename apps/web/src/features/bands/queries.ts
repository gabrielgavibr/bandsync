import type { BandDto, BandMemberDto, InviteDto, RehearsalSessionDto } from "@bandsync/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/api";

export const bandKeys = {
  all: ["bands"] as const,
  one: (id: string) => ["bands", id] as const,
  members: (id: string) => ["bands", id, "members"] as const,
  invites: (id: string) => ["bands", id, "invites"] as const,
  rehearsals: (id: string) => ["bands", id, "rehearsals"] as const,
};

export function useBands() {
  return useQuery({
    queryKey: bandKeys.all,
    queryFn: () => http.get<{ bands: BandDto[] }>("/api/bands").then((r) => r.bands),
  });
}

export function useBand(bandId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: (opts.enabled ?? true) && !!bandId,
    queryKey: bandKeys.one(bandId),
    queryFn: () => http.get<{ band: BandDto }>(`/api/bands/${bandId}`).then((r) => r.band),
  });
}

export function useMembers(bandId: string) {
  return useQuery({
    queryKey: bandKeys.members(bandId),
    queryFn: () =>
      http.get<{ members: BandMemberDto[] }>(`/api/bands/${bandId}/members`).then((r) => r.members),
  });
}

export function useInvites(bandId: string, enabled = true) {
  return useQuery({
    queryKey: bandKeys.invites(bandId),
    enabled,
    queryFn: () =>
      http.get<{ invites: InviteDto[] }>(`/api/bands/${bandId}/invites`).then((r) => r.invites),
  });
}

export function useRehearsals(bandId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: (opts.enabled ?? true) && !!bandId,
    queryKey: bandKeys.rehearsals(bandId),
    refetchInterval: 15_000,
    queryFn: () =>
      http.get<{ active: RehearsalSessionDto | null; recent: RehearsalSessionDto[] }>(
        `/api/bands/${bandId}/rehearsals`,
      ),
  });
}

export function useCreateBand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; genre?: string }) =>
      http.post<{ band: BandDto }>("/api/bands", input).then((r) => r.band),
    onSuccess: () => qc.invalidateQueries({ queryKey: bandKeys.all }),
  });
}

export function useCreateInvite(bandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      http.post<{ invite: InviteDto; url: string; emailSent: boolean }>(
        `/api/bands/${bandId}/invites`,
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: bandKeys.invites(bandId) }),
  });
}

export function useRevokeInvite(bandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => http.delete(`/api/bands/${bandId}/invites/${inviteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: bandKeys.invites(bandId) }),
  });
}

export function useUpdateMember(bandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, patch }: { userId: string; patch: Record<string, unknown> }) =>
      http.patch(`/api/bands/${bandId}/members/${userId}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bandKeys.members(bandId) });
      void qc.invalidateQueries({ queryKey: bandKeys.one(bandId) });
    },
  });
}

export function useRemoveMember(bandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => http.delete(`/api/bands/${bandId}/members/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bandKeys.members(bandId) });
      void qc.invalidateQueries({ queryKey: bandKeys.all });
    },
  });
}
