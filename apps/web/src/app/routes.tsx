import { lazy } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { LoadingBlock } from "../components/ui/Misc";
import { useAuth } from "../features/auth/AuthProvider";
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from "../features/auth/pages";
import { BandDashboardPage } from "../features/bands/BandDashboardPage";
import { BandLayout } from "../features/bands/BandLayout";
import { CreateBandPage } from "../features/bands/CreateBandPage";
import { HomePage } from "../features/bands/HomePage";
import { InvitePage } from "../features/bands/InvitePage";
import { JoinPage } from "../features/bands/JoinPage";
import { MembersPage } from "../features/bands/MembersPage";
import { MyBandsPage } from "../features/bands/MyBandsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { RehearsalLobbyPage } from "../features/rehearsal/RehearsalLobbyPage";
import { RepertoireDetailPage } from "../features/repertoire/RepertoireDetailPage";
import { RepertoiresPage } from "../features/repertoire/RepertoiresPage";
import { SongDetailPage } from "../features/repertoire/SongDetailPage";
import { SongsPage } from "../features/repertoire/SongsPage";
import { AppShell } from "./AppShell";

// Heavy, rarely-first-visited screens load on demand (audio engine, tuner, editors).
const RehearsalRoomPage = lazy(() =>
  import("../features/rehearsal/RehearsalRoomPage").then((m) => ({ default: m.RehearsalRoomPage })),
);
const ToolsPage = lazy(() =>
  import("../features/tools/ToolsPage").then((m) => ({ default: m.ToolsPage })),
);
const AddSongWizardPage = lazy(() =>
  import("../features/autoarrange/AddSongWizardPage").then((m) => ({
    default: m.AddSongWizardPage,
  })),
);
const ArrangementPage = lazy(() =>
  import("../features/arrangement/ArrangementPage").then((m) => ({
    default: m.ArrangementPage,
  })),
);
const SongFormPage = lazy(() =>
  import("../features/repertoire/SongFormPage").then((m) => ({ default: m.SongFormPage })),
);

import { NotFoundPage } from "./NotFoundPage";

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <LoadingBlock className="min-h-screen" />;
  if (status === "anonymous")
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function AnonymousOnly() {
  const { status } = useAuth();
  const location = useLocation() as { state?: { from?: string } };
  if (status === "loading") return <LoadingBlock className="min-h-screen" />;
  if (status === "authenticated") return <Navigate to={location.state?.from ?? "/"} replace />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AnonymousOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/bands" element={<MyBandsPage />} />
          <Route path="/bands/new" element={<CreateBandPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/bands/:bandId" element={<BandLayout />}>
            <Route index element={<BandDashboardPage />} />
            <Route path="songs" element={<SongsPage />} />
            <Route path="songs/add" element={<AddSongWizardPage />} />
            <Route path="songs/new" element={<SongFormPage />} />
            <Route path="songs/:songId" element={<SongDetailPage />} />
            <Route path="songs/:songId/edit" element={<SongFormPage />} />
            <Route path="songs/:songId/arrangement" element={<ArrangementPage />} />
            <Route path="repertoires" element={<RepertoiresPage />} />
            <Route path="repertoires/:repertoireId" element={<RepertoireDetailPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="invite" element={<InvitePage />} />
            <Route path="rehearsal" element={<RehearsalLobbyPage />} />
            <Route path="tools" element={<ToolsPage />} />
          </Route>
        </Route>
        {/* The live room uses its own full-screen layout. */}
        <Route path="/bands/:bandId/rehearsal/:sessionId" element={<RehearsalRoomPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
