import type { UserDto, UserPreferencesDto } from "@bandsync/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, http, onUnauthorized } from "../../lib/api";
import { resolveLocale, setLocale } from "../../lib/i18n";
import { useTheme } from "../../lib/theme";

export interface AuthState {
  status: "loading" | "anonymous" | "authenticated";
  user: UserDto | null;
  preferences: UserPreferencesDto | null;
}

interface AuthCtx extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    primaryInstrument?: string;
    locale: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applySession: (user: UserDto, preferences: UserPreferencesDto) => void;
  updatePreferences: (patch: Partial<UserPreferencesDto>) => Promise<void>;
  updateProfile: (
    patch: Partial<
      Pick<UserDto, "displayName" | "primaryInstrument" | "secondaryInstruments" | "avatarUrl">
    >,
  ) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

type MeResponse = { user: UserDto; preferences: UserPreferencesDto };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
    preferences: null,
  });
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();

  const applySession = useCallback(
    (user: UserDto, preferences: UserPreferencesDto) => {
      setState({ status: "authenticated", user, preferences });
      // Account preferences win over device defaults so every device of the user matches.
      void setLocale(resolveLocale(preferences.locale));
      if (
        preferences.theme === "light" ||
        preferences.theme === "dark" ||
        preferences.theme === "system"
      ) {
        setTheme(preferences.theme);
      }
    },
    [setTheme],
  );

  const clear = useCallback(() => {
    setState({ status: "anonymous", user: null, preferences: null });
    queryClient.clear();
  }, [queryClient]);

  const refresh = useCallback(async () => {
    try {
      const me = await http.get<MeResponse>("/api/me");
      applySession(me.user, me.preferences);
    } catch (err) {
      if (err instanceof ApiError && err.code === "unauthorized") clear();
      else if (err instanceof ApiError && err.code === "network") {
        // Keep whatever we had; the UI shows the offline banner.
        setState((s) => (s.status === "loading" ? { ...s, status: "anonymous" } : s));
      } else clear();
    }
  }, [applySession, clear]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onUnauthorized(clear), [clear]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await http.post<MeResponse>("/api/auth/login", { email, password });
      applySession(res.user, res.preferences);
    },
    [applySession],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      displayName: string;
      primaryInstrument?: string;
      locale: string;
    }) => {
      const res = await http.post<MeResponse>("/api/auth/register", input);
      applySession(res.user, res.preferences);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await http.post("/api/auth/logout");
    } finally {
      clear();
    }
  }, [clear]);

  const updatePreferences = useCallback(
    async (patch: Partial<UserPreferencesDto>) => {
      const res = await http.patch<{ preferences: UserPreferencesDto }>(
        "/api/me/preferences",
        patch,
      );
      setState((s) => ({ ...s, preferences: res.preferences }));
      if (patch.locale) void setLocale(resolveLocale(patch.locale));
      if (patch.theme === "light" || patch.theme === "dark" || patch.theme === "system")
        setTheme(patch.theme);
    },
    [setTheme],
  );

  const updateProfile = useCallback(async (patch: Parameters<AuthCtx["updateProfile"]>[0]) => {
    const res = await http.patch<{ user: UserDto }>("/api/me", patch);
    setState((s) => ({ ...s, user: res.user }));
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      ...state,
      login,
      register,
      logout,
      refresh,
      applySession,
      updatePreferences,
      updateProfile,
    }),
    [state, login, register, logout, refresh, applySession, updatePreferences, updateProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
