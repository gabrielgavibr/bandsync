import type { FileDto, RepertoireDto, SongDto, SongMaterialDto } from "@bandsync/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/api";

export const repKeys = {
  songs: (bandId: string) => ["bands", bandId, "songs"] as const,
  song: (bandId: string, songId: string) => ["bands", bandId, "songs", songId] as const,
  repertoires: (bandId: string) => ["bands", bandId, "repertoires"] as const,
  repertoire: (bandId: string, id: string) => ["bands", bandId, "repertoires", id] as const,
};

export type SongWithMaterials = { song: SongDto; materials: SongMaterialDto[] };

export function useSongs(bandId: string) {
  return useQuery({
    queryKey: repKeys.songs(bandId),
    queryFn: () =>
      http.get<{ songs: SongDto[] }>(`/api/bands/${bandId}/songs`).then((r) => r.songs),
  });
}

export function useSong(bandId: string, songId: string | null | undefined) {
  return useQuery({
    queryKey: repKeys.song(bandId, songId ?? ""),
    enabled: !!songId,
    queryFn: () => http.get<SongWithMaterials>(`/api/bands/${bandId}/songs/${songId}`),
  });
}

export function useSaveSong(bandId: string, songId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      songId
        ? http
            .patch<{ song: SongDto }>(`/api/bands/${bandId}/songs/${songId}`, input)
            .then((r) => r.song)
        : http.post<{ song: SongDto }>(`/api/bands/${bandId}/songs`, input).then((r) => r.song),
    onSuccess: (song) => {
      void qc.invalidateQueries({ queryKey: repKeys.songs(bandId) });
      void qc.invalidateQueries({ queryKey: repKeys.song(bandId, song.id) });
    },
  });
}

export function useDeleteSong(bandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (songId: string) => http.delete(`/api/bands/${bandId}/songs/${songId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: repKeys.songs(bandId) }),
  });
}

export function useSaveMaterial(bandId: string, songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Record<string, unknown> }) =>
      id
        ? http.patch<{ material: SongMaterialDto }>(
            `/api/bands/${bandId}/songs/${songId}/materials/${id}`,
            input,
          )
        : http.post<{ material: SongMaterialDto }>(
            `/api/bands/${bandId}/songs/${songId}/materials`,
            input,
          ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: repKeys.song(bandId, songId) });
      void qc.invalidateQueries({ queryKey: repKeys.songs(bandId) });
    },
  });
}

export function useDeleteMaterial(bandId: string, songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/api/bands/${bandId}/songs/${songId}/materials/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: repKeys.song(bandId, songId) });
      void qc.invalidateQueries({ queryKey: repKeys.songs(bandId) });
    },
  });
}

export function useUploadFile(bandId: string) {
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set("file", file);
      return http.upload<{ file: FileDto }>(`/api/bands/${bandId}/files`, fd).then((r) => r.file);
    },
  });
}

export function useRepertoires(bandId: string) {
  return useQuery({
    queryKey: repKeys.repertoires(bandId),
    queryFn: () =>
      http
        .get<{ repertoires: RepertoireDto[] }>(`/api/bands/${bandId}/repertoires`)
        .then((r) => r.repertoires),
  });
}

export function useRepertoire(bandId: string, id: string | null | undefined) {
  return useQuery({
    queryKey: repKeys.repertoire(bandId, id ?? ""),
    enabled: !!id,
    queryFn: () =>
      http
        .get<{ repertoire: RepertoireDto }>(`/api/bands/${bandId}/repertoires/${id}`)
        .then((r) => r.repertoire),
  });
}

export function useRepertoireMutations(bandId: string, id?: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: repKeys.repertoires(bandId) });
    if (id) void qc.invalidateQueries({ queryKey: repKeys.repertoire(bandId, id) });
  };
  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      http
        .post<{ repertoire: RepertoireDto }>(`/api/bands/${bandId}/repertoires`, input)
        .then((r) => r.repertoire),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      http.patch(`/api/bands/${bandId}/repertoires/${id}`, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/api/bands/${bandId}/repertoires/${id}`),
    onSuccess: invalidate,
  });
  const addItem = useMutation({
    mutationFn: (songId: string) =>
      http.post(`/api/bands/${bandId}/repertoires/${id}/items`, { songId }),
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: (songId: string) =>
      http.delete(`/api/bands/${bandId}/repertoires/${id}/items/${songId}`),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (songIds: string[]) =>
      http.put(`/api/bands/${bandId}/repertoires/${id}/order`, { songIds }),
    onSuccess: invalidate,
  });
  return { create, update, remove, addItem, removeItem, reorder };
}
