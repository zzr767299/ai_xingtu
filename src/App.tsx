import { HashRouter, Route, Routes } from "react-router-dom";
import { AppProvider } from "./state/AppContext";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { MapPage } from "./pages/MapPage";
import { ChapterPage } from "./pages/ChapterPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { GlossaryPage } from "./pages/GlossaryPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/learn/:chapterId" element={<ChapterPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/glossary" element={<GlossaryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Layout>
      </AppProvider>
    </HashRouter>
  );
}
