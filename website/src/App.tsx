import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppStoreProvider } from "./store/AppStore";
import { ToastProvider } from "./ui/Toast";
import { AppShell } from "./layout/AppShell";
import { Overview } from "./pages/Overview";
import { SchedulePage } from "./pages/Schedule";
import { RemindersPage } from "./pages/Reminders";
import { ReviewPage } from "./pages/Review";
import { BoardPage } from "./pages/Board";
import { DevicePage } from "./pages/DevicePage";
import { SttPage } from "./pages/Stt";
import { AgentPage, ControlsPage, LightingPage, MePage, ScreenPage, SettingsPage } from "./pages/SettingsPages";

export default function App() {
  return (
    <ToastProvider>
      <AppStoreProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Overview />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="reminders" element={<RemindersPage />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="board" element={<BoardPage />} />
              <Route path="agent" element={<AgentPage />} />
              <Route path="device" element={<DevicePage />} />
              <Route path="stt" element={<SttPage />} />
              <Route path="controls" element={<ControlsPage />} />
              <Route path="screen" element={<ScreenPage />} />
              <Route path="lighting" element={<LightingPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="me" element={<MePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AppStoreProvider>
    </ToastProvider>
  );
}
