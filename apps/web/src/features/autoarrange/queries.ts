import {
  type AnalysisJobDto,
  type AnalysisReport,
  type AnalysisResultDto,
  type AudioAssetDto,
  isRunningJob,
  type PreparationState,
  type RecordingArrangementDto,
  type RecordingCandidate,
  type RecordingDetails,
  type RecordingRelease,
  type ReferenceDependents,
  type ReferenceLinkInfo,
  type ReferenceUsedBy,
  type ReviewEventDto,
  type ReviewInput,
  type SaveArrangementInput,
  type SongDto,
  type SongRecordingDto,
  type SubmitPrearrangementInput,
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
  /** Confirmed while another recording (or none) was the reference. */
  beforeReferenceChange: boolean;
}

export interface SongAnalysisOverview {
  song: SongDto;
  recordings: SongRecordingDto[];
  jobs: AnalysisJobDto[];
  results: AnalysisResultDto[];
  reviews: ReviewEventDto[];
  audioAssets: AudioAssetDto[];
  preparation: PreparationState;
  dependents: ReferenceDependents | null;
  confirmations: Record<"band_bpm" | "band_key" | "band_meter", Confirmation | null>;
  engines: { audioAnalysis: string };
  /** Newest pre-arrangement made for the current reference recording. */
  prearrangement: RecordingArrangementDto | null;
  prearrangements: PrearrangementSummary[];
}

export interface PrearrangementSummary {
  id: string;
  source: RecordingArrangementDto["source"];
  recordingId: string | null;
  createdAt: string;
  createdByName: string | null;
  sections: number;
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

/** Asks the platform of a pasted link what it says about that recording. */
export type IdentifiedLink = ReferenceLinkInfo & { usedBy: ReferenceUsedBy[] };

export function useIdentifyReference(bandId: string, songId?: string | null) {
  return useMutation({
    mutationFn: (url: string) =>
      http
        .post<{ reference: ReferenceLinkInfo; usedBy?: ReferenceUsedBy[] }>(
          `${base(bandId)}/reference/identify`,
          { url, songId: songId ?? null },
        )
        .then((r): IdentifiedLink => ({ ...r.reference, usedBy: r.usedBy ?? [] })),
  });
}

export interface PrepareResponse {
  song: SongDto;
  recording: SongRecordingDto;
  job: AnalysisJobDto;
  songCreated: boolean;
  reused: boolean;
  replaced: boolean;
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

function useOverviewMutation<T>(
  bandId: string,
  songId: string,
  mutationFn: (input: T) => Promise<SongAnalysisOverview>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      qc.setQueryData(aaKeys.overview(bandId, songId), data);
      void qc.invalidateQueries({ queryKey: repKeys.song(bandId, songId) });
      void qc.invalidateQueries({ queryKey: repKeys.songs(bandId) });
      void qc.invalidateQueries({ queryKey: repKeys.repertoires(bandId) });
    },
  });
}

/** Same recording, another (or a first) link. */
export function useSetReferenceLink(bandId: string, songId: string) {
  return useOverviewMutation(bandId, songId, (url: string) =>
    http.put<SongAnalysisOverview>(`${base(bandId)}/songs/${songId}/reference/link`, { url }),
  );
}

export function useEditReference(bandId: string, songId: string) {
  return useOverviewMutation(
    bandId,
    songId,
    (input: { title?: string; artistCredit?: string | null }) =>
      http.patch<SongAnalysisOverview>(`${base(bandId)}/songs/${songId}/reference`, input),
  );
}

/** Stores an analysis run on this device (microphone or authorised file). */
export function useSubmitAnalysis(bandId: string, songId: string) {
  return useOverviewMutation(
    bandId,
    songId,
    (
      input: AnalysisReport & { input: "microphone" | "audio_file"; audioAssetId?: string | null },
    ) => http.post<SongAnalysisOverview>(`${base(bandId)}/songs/${songId}/analysis`, input),
  );
}

/** Registers an uploaded file as audio the band declares it may process, for the reference. */
export function useDeclareAudio(bandId: string, songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { fileId: string; rightsBasis: string; rightsNote: string | null }) =>
      http
        .post<{ audioAsset: AudioAssetDto }>(`${base(bandId)}/songs/${songId}/audio-assets`, {
          ...input,
          declaration: true,
        })
        .then((r) => r.audioAsset),
    onSuccess: () => qc.invalidateQueries({ queryKey: aaKeys.overview(bandId, songId) }),
  });
}

/** Stores a pre-arrangement of the reference recording built on this device. */
export function useSubmitPrearrangement(bandId: string, songId: string) {
  return useOverviewMutation(bandId, songId, (input: SubmitPrearrangementInput) =>
    http.post<SongAnalysisOverview>(`${base(bandId)}/songs/${songId}/prearrangement`, input),
  );
}

/** Saves the band's own arrangement; the recording's pre-arrangement is never changed. */
export function useSaveArrangement(bandId: string, songId: string) {
  return useOverviewMutation(bandId, songId, (input: SaveArrangementInput) =>
    http.put<SongAnalysisOverview>(`${base(bandId)}/songs/${songId}/arrangement`, input),
  );
}

/** The duration the official player reports, kept as a fact about the reference. */
export function useReportPlayerDuration(bandId: string, songId: string) {
  return useOverviewMutation(bandId, songId, (seconds: number) =>
    http.post<SongAnalysisOverview>(`${base(bandId)}/songs/${songId}/reference/duration`, {
      seconds,
    }),
  );
}
