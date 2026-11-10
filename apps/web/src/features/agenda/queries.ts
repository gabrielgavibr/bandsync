import type {
  AgendaDto,
  AttendanceEntryDto,
  AttendanceStatus,
  BoardCommentDto,
  OccurrenceDto,
  PersonalInviteDto,
} from "@bandsync/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/api";

export const agendaKeys = {
  agenda: (bandId: string) => ["bands", bandId, "agenda"] as const,
  occurrence: (bandId: string, id: string) => ["bands", bandId, "agenda", id] as const,
  board: (bandId: string, id: string) => ["bands", bandId, "agenda", id, "board"] as const,
  personalInvites: (bandId: string) => ["bands", bandId, "personal-invites"] as const,
};

export function useAgenda(bandId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: (opts.enabled ?? true) && !!bandId,
    queryKey: agendaKeys.agenda(bandId),
    refetchInterval: 30_000,
    queryFn: () => http.get<AgendaDto>(`/api/bands/${bandId}/agenda`),
  });
}

export function useOccurrence(bandId: string, eventId: string) {
  return useQuery({
    queryKey: agendaKeys.occurrence(bandId, eventId),
    refetchInterval: 15_000,
    queryFn: () =>
      http.get<{ occurrence: OccurrenceDto; attendance: AttendanceEntryDto[] }>(
        `/api/bands/${bandId}/agenda/occurrences/${eventId}`,
      ),
  });
}

export function useSetAttendance(bandId: string, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: AttendanceStatus) =>
      http.put<{ occurrence: OccurrenceDto; attendance: AttendanceEntryDto[] }>(
        `/api/bands/${bandId}/agenda/occurrences/${eventId}/attendance`,
        { status },
      ),
    onSuccess: (data) => {
      qc.setQueryData(agendaKeys.occurrence(bandId, eventId), data);
      void qc.invalidateQueries({ queryKey: agendaKeys.agenda(bandId) });
    },
  });
}

/** The board refreshes on its own every few seconds while it is on screen. */
export const BOARD_POLL_MS = 4000;

export function useBoard(bandId: string, eventId: string, enabled = true) {
  return useQuery({
    enabled: enabled && !!eventId,
    queryKey: agendaKeys.board(bandId, eventId),
    refetchInterval: BOARD_POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: () =>
      http
        .get<{ comments: BoardCommentDto[] }>(
          `/api/bands/${bandId}/agenda/occurrences/${eventId}/comments`,
        )
        .then((r) => r.comments),
  });
}

export function usePersonalInvites(bandId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: agendaKeys.personalInvites(bandId),
    queryFn: () =>
      http
        .get<{ invites: PersonalInviteDto[] }>(`/api/bands/${bandId}/personal-invites`)
        .then((r) => r.invites),
  });
}
