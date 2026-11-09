import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { BrowserRouter } from "react-router";
import { LoadingBlock } from "../components/ui/Misc";
import { ToastProvider } from "../components/ui/Toast";
import { AuthProvider } from "../features/auth/AuthProvider";
import { ApiError } from "../lib/api";
import { ThemeProvider } from "../lib/theme";
import { AppRoutes } from "./routes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Suspense fallback={<LoadingBlock />}>
                <AppRoutes />
              </Suspense>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
