import React from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { useDatasetRows } from "../lib/hooks";

const COLORS = ["#06b6d4", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#f97316", "#ec4899"];

interface ChartWidgetProps {
  chart: {
    chartType: string;
    datasetId?: number;
    config: {
      xField?: string;
      yField?: string;
      [key: string]: unknown;
    };
  };
}

export default function ChartWidget({ chart }: ChartWidgetProps) {
  const { data: rowsData, isLoading } = useDatasetRows(chart.datasetId || 0, 200, 0);

  if (!chart.datasetId) {
    return <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>No dataset selected</div>;
  }

  if (isLoading) {
    return <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>Loading data...</div>;
  }

  const rows = rowsData?.rows || [];
  if (rows.length === 0) {
    return <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>No data available</div>;
  }

  const xField = chart.config.xField || Object.keys(rows[0])[0];
  const yField = chart.config.yField || Object.keys(rows[0])[1];

  // Ensure numeric y values
  const data = rows.map((r: any) => ({
    ...r,
    [yField]: typeof r[yField] === "number" ? r[yField] : parseFloat(r[yField]) || 0
  }));

  const chartProps = { width: "100%", height: 250 };

  switch (chart.chartType) {
    case "bar":
      return (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey={xField} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
            <Bar dataKey={yField} fill={COLORS[0]} />
          </BarChart>
        </ResponsiveContainer>
      );

    case "line":
      return (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey={xField} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
            <Line type="monotone" dataKey={yField} stroke={COLORS[0]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      );

    case "area":
      return (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey={xField} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
            <Area type="monotone" dataKey={yField} stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.2} />
          </AreaChart>
        </ResponsiveContainer>
      );

    case "pie":
      return (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={data.slice(0, 10)} dataKey={yField} nameKey={xField} cx="50%" cy="50%" outerRadius={80} label>
              {data.slice(0, 10).map((_: any, i: number) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );

    case "scatter":
      return (
        <ResponsiveContainer width="100%" height={250}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey={xField} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            <YAxis dataKey={yField} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
            <Scatter data={data} fill={COLORS[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      );

    case "stat": {
      const sum = data.reduce((acc: number, r: any) => acc + (r[yField] || 0), 0);
      const avg = data.length > 0 ? sum / data.length : 0;
      return (
        <div className="text-center py-4">
          <div className="text-3xl font-bold" style={{ color: "var(--color-primary)" }}>{sum.toLocaleString()}</div>
          <div className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>Total {yField}</div>
          <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>Avg: {avg.toFixed(2)} ({data.length} rows)</div>
        </div>
      );
    }

    case "table":
      return (
        <div className="overflow-x-auto max-h-64">
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="text-left p-1" style={{ color: "var(--color-text-muted)" }}>{xField}</th>
                <th className="text-left p-1" style={{ color: "var(--color-text-muted)" }}>{yField}</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 20).map((r: any, i: number) => (
                <tr key={i} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td className="p-1">{String(r[xField] ?? "")}</td>
                  <td className="p-1">{String(r[yField] ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>Unknown chart type: {chart.chartType}</div>;
  }
}
