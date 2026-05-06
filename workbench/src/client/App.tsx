import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import Layout from "./components/Layout";
import ScrapeListPage from "./pages/ScrapeListPage";
import ScrapeNewPage from "./pages/ScrapeNewPage";
import ScrapeDetailPage from "./pages/ScrapeDetailPage";
import DatasetListPage from "./pages/DatasetListPage";
import DatasetViewPage from "./pages/DatasetViewPage";
import DashboardListPage from "./pages/DashboardListPage";
import DashboardEditPage from "./pages/DashboardEditPage";
import DatabasesPage from "./pages/DatabasesPage";
import DatasetBuilderPage from "./pages/DatasetBuilderPage";
import SettingsPage from "./pages/SettingsPage";
import JobApiPage from "./pages/JobApiPage";
import MergeListPage from "./pages/MergeListPage";
import MergeBuilderPage from "./pages/MergeBuilderPage";

export default function App() {
  return (
    <ToastProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/scrapes" replace />} />
          <Route path="/scrapes" element={<ScrapeListPage />} />
          <Route path="/scrapes/new" element={<ScrapeNewPage />} />
          <Route path="/scrapes/:id" element={<ScrapeDetailPage />} />
          <Route path="/scrapes/:id/api" element={<JobApiPage />} />
          <Route path="/scrapes/:id/build" element={<DatasetBuilderPage />} />
          <Route path="/datasets" element={<DatasetListPage />} />
          <Route path="/datasets/:id" element={<DatasetViewPage />} />
          <Route path="/dashboards" element={<DashboardListPage />} />
          <Route path="/dashboards/:id" element={<DashboardEditPage />} />
          <Route path="/databases" element={<DatabasesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/merges" element={<MergeListPage />} />
          <Route path="/merges/new" element={<MergeBuilderPage />} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
