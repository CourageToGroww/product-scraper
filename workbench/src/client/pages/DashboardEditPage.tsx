import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useDashboard, useDatasets } from "../lib/hooks";
import ChartWidget from "../components/ChartWidget";
import * as api from "../lib/api";
import { useToast } from "../components/Toast";

export default function DashboardEditPage() {
  const { id } = useParams();
  const dashboardId = Number(id);
  const { data: dashboard, isLoading, refetch } = useDashboard(dashboardId);
  const { data: datasetsData } = useDatasets();
  const { toast } = useToast();
  const [showAddChart, setShowAddChart] = useState(false);
  const [chartName, setChartName] = useState("");
  const [chartType, setChartType] = useState<string>("bar");
  const [datasetId, setDatasetId] = useState("");
  const [xField, setXField] = useState("");
  const [yField, setYField] = useState("");

  if (isLoading) return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="skeleton" style={{ width: "50%", height: "1.5rem" }} />
      <div className="skeleton" style={{ width: "100%", height: "300px" }} />
    </div>
  );
  if (!dashboard) return <p style={{ color: "var(--color-error)" }}>Dashboard not found</p>;

  const handleAddChart = async () => {
    if (!chartName || !chartType) return;
    try {
      await api.dashboards.addChart(dashboardId, {
        name: chartName,
        chartType,
        datasetId: datasetId ? Number(datasetId) : undefined,
        config: { xField, yField },
        position: { x: 0, y: (dashboard.charts?.length || 0) * 4, w: 6, h: 4 }
      });
      setChartName("");
      setChartType("bar");
      setDatasetId("");
      setXField("");
      setYField("");
      setShowAddChart(false);
      refetch();
      toast("Chart added", "success");
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const handleDeleteChart = async (chartId: number) => {
    try {
      await api.dashboards.deleteChart(chartId);
      refetch();
      toast("Chart removed", "info");
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Link to="/dashboards" className="text-sm no-underline flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </Link>
        <span className="text-base font-semibold" style={{ letterSpacing: "-0.01em" }}>{dashboard.name}</span>
        <button onClick={() => setShowAddChart(!showAddChart)} className="btn-primary" style={{ marginLeft: "auto" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Chart
        </button>
      </div>

      {showAddChart && (
        <div className="glass-card p-4 mb-2">
          <h3 className="text-sm font-semibold m-0 mb-3">New Chart</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Name</label>
              <input className="input-field" value={chartName} onChange={e => setChartName(e.target.value)} placeholder="Chart name" />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Type</label>
              <select className="input-field" value={chartType} onChange={e => setChartType(e.target.value)}>
                <option value="bar">Bar Chart</option>
                <option value="line">Line Chart</option>
                <option value="pie">Pie Chart</option>
                <option value="area">Area Chart</option>
                <option value="scatter">Scatter Plot</option>
                <option value="stat">Stat Card</option>
                <option value="table">Table</option>
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Dataset</label>
              <select className="input-field" value={datasetId} onChange={e => setDatasetId(e.target.value)}>
                <option value="">Select dataset...</option>
                {datasetsData?.datasets?.map((ds: any) => (
                  <option key={ds.id} value={ds.id}>{ds.name} ({ds.rowCount} rows)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>X Field</label>
              <input className="input-field" value={xField} onChange={e => setXField(e.target.value)} placeholder="e.g. name" />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Y Field</label>
              <input className="input-field" value={yField} onChange={e => setYField(e.target.value)} placeholder="e.g. price" />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleAddChart} className="btn-primary" style={{ flex: 1 }}>Add</button>
              <button onClick={() => setShowAddChart(false)} className="btn-ghost">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {dashboard.charts?.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M8 16V12M12 16V8M16 16v-2" />
          </svg>
          <p className="text-sm m-0 mb-2" style={{ fontWeight: 500 }}>No charts yet</p>
          <p className="text-xs m-0">Add a chart to start visualizing your data.</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-1 lg:grid-cols-2">
        {dashboard.charts?.map((chart: any) => (
          <div key={chart.id} className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-sm">{chart.name}</span>
              <button onClick={() => handleDeleteChart(chart.id)} className="btn-danger" style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem" }}>
                Delete
              </button>
            </div>
            <ChartWidget chart={chart} />
          </div>
        ))}
      </div>
    </div>
  );
}
