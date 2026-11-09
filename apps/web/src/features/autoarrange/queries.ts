import {
  type AnalysisJobDto,
  type AnalysisResultDto,
  type AudioAssetDto,
  type ConnectorInfo,
  isRunningJob,
  type RecordingCandidate,
  type RecordingDetails,
  type RecordingRelease,
  type ReviewEventDto,
  type ReviewInput,
  type SongDto,
  type SongRecordingDto,
  type YouTubeVideoInfo,
} from "@bandsync/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../../lib/api";
import { repKeys } from "../repertoire/queries";

const base = (bandId: string) => `/api/bands/${bandId}/autoarrange`;

export const aaKeys = {
  search: (bandId: string, title: string, artist: string) =>
    ["aa", bandId, "search", title, artist] as const,
  recording: (bandId: string, mbid: string) => ["aa", bandId, "recording", mbid] as const,
  job: (bandId: string, jobId: string) => ["aa", bandId, "job", jobId] as const,
  overview: (bandId: string, songId: string) => ["aa", bandId, "song", songId] as const,
  connectors: (bandId: string) => ["aa", bandId, "connectors"] as const,
};

export interface Confirmation {
  value: unknown;
  userId: string;
  userName: string | null;
  at: string;
  action: string;
}

export interface SongAnalysisOverview {
  song: SongDto;
  recordings: SongRecordingDto[];
  jobs: AnalysisJobDto[];
  results: AnalysisResultDto[];
  reviews: ReviewEventDto[];
  audioAssets: AudioAssetDto[];
  confirmations: Record<"band_bpm" | "band_key" | "band_meter", Confirmation | null>;
  engines: { audioAnalysis: string };
}

export function useRecordingSearch(
  bandId: string,
  query: { title: string; artist: string } | null,
) {
  return useQuery({
    queryKey: aaKeys.search(bandId, query?.title ?? "", query?.artist ?? ""),
    enabled: !!query && query.title.trim().length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => {
      const params = new URLSearchParams({ title: query!.title });
      if (query!.artist.trim()) params.set("artist", query!.artist);
      return http
        .get<{ recordings: RecordingCandidate[] }>(`${base(bandId)}/search?${params}`)
        .then((r) => r.recordings);
    },
  });
}

export function useRecordingDetails(bandId: string, mbid: string | null) {
  return useQuery({
    queryKey: aaKeys.recording(bandId, mbid ?? ""),
    enabled: !!mbid,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () =>
      http.get<{
        recording: RecordingDetails;
        defaultRelease: RecordingRelease | null;
        authors: string[];
      }>(`${base(bandId)}/recordings/${mbid}`),
  });
}

export function useYouTubeLookup(bandId: string) {
  return useMutation({
    mutationFn: (url: string) =>
      http
        .post<{ video: YouTubeVideoInfo }>(`${base(bandId)}/youtube`, { url })
        .then((r) => r.video),
  });
}

export interface PrepareResponse {
  song: SongDto;
  recording: SongRecordingDto;
  job: AnalysisJobDto;
  songCreated: boolean;
  reused: boolean;
}

export function usePrepare(bandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      http.post<PrepareResponse>(`${base(bandId)}/prepare`, input),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: repKeys.songs(bandId) });
      void qc.invalidateQueries({ queryKey: repKeys.song(bandId, res.song.id) });
      void qc.invalidateQueries({ queryKey: aaKeys.overview(bandId, res.song.id) });
    },
  });
}

/** Polls while the pipeline is running; stops once it waits for a person or has ended. */
export function useJob(bandId: string, jobId: string | null) {
  return useQuery({
    queryKey: aaKeys.job(bandId, jobId ?? ""),
    enabled: !!jobId,
    queryFn: () =>
      http.get<{ job: AnalysisJobDto }>(`${base(bandId)}/jobs/${jobId}`).then((r) => r.job),
    refetchInterval: (q) => (q.state.data && !isRunningJob(q.state.data.status) ? false : 700),
  });
}

export function useJobAction(bandId: string, songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, action }: { jobId: string; action: "cancel" | "retry" | "complete" }) =>
      http
        .post<{ job: AnalysisJobDto }>(`${base(bandId)}/jobs/${jobId}/${action}`)
        .then((r) => r.job),
    onSuccess: (job) => {
      qc.setQueryData(aaKeys.job(bandId, job.id), job);
      void qc.invalidateQueries({ queryKey: aaKeys.job(bandId, job.id) });
      void qc.invalidateQueries({ queryKey: aaKeys.overview(bandId, songId) });
    },
  });
}

export function useSongAnalysis(bandId: string, songId: string | null | undefined, live = false) {
  return useQuery({
    queryKey: aaKeys.overview(bandId, songId ?? ""),
    enabled: !!songId,
    queryFn: () => http.get<SongAnalysisOverview>(`${base(bandId)}/songs/${songId}`),
    refetchInterval: (q) => {
      const latest = q.state.data?.jobs[0];
      return live && latest && isRunningJob(latest.status) ? 900 : false;
    },
  });
}

export function useReview(bandId: string, songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReviewInput) =>
      http.post<SongAnalysisOverview>(`${base(bandId)}/songs/${songId}/review`, input),
    onSuccess: (data) => {
      qc.setQueryData(aaKeys.overview(bandId, songId), data);
      void qc.invalidateQueries({ queryKey: repKeys.song(bandId, songId) });
      void qc.invalidateQueries({ queryKey: repKeys.songs(bandId) });
    },
  });
}

export function useConnectors(bandId: string) {
  return useQuery({
    queryKey: aaKeys.connectors(bandId),
    staleTime: 60 * 60_000,
    queryFn: () =>
      http.get<{ connectors: ConnectorInfo[]; engines: { audioAnalysis: string } }>(
        `${base(bandId)}/connectors`,
      ),
  });
}
