"use client";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const PALETTE = ["#c27585", "#7f9f80", "#c39a5c", "#9b8bc4", "#d98f73", "#6f97b8", "#a8607f", "#9da267", "#5f9a95", "#b9846a", "#7a6a8e", "#a99689"];
type Point = { label: string; value: number };
const fmt = (v: unknown) => `$${Number(v).toFixed(2)}`;

export default function Chart({ type, points }: { type: "bar" | "pie" | "line"; points: Point[] }) {
  const tooltip = <Tooltip formatter={fmt} contentStyle={{ borderRadius: 14, border: "1px solid #efdfd7", background: "#fffdfa", fontSize: 12, color: "#4b3a3c" }} />;
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {type === "pie" ? (
          <PieChart>
            <Pie data={points} dataKey="value" nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={2} cornerRadius={4} stroke="#fffdfa" strokeWidth={2}
                 label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`} labelLine={false} fontSize={11}>
              {points.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            {tooltip}
          </PieChart>
        ) : type === "line" ? (
          <LineChart data={points} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid stroke="#f3e6df" vertical={false} />
            <XAxis dataKey="label" fontSize={11} tickLine={false} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={48} />
            {tooltip}
            <Line type="monotone" dataKey="value" stroke="#b9677a" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        ) : (
          <BarChart data={points} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid stroke="#f3e6df" vertical={false} />
            <XAxis dataKey="label" fontSize={11} tickLine={false} interval={0} angle={points.length > 6 ? -30 : 0} textAnchor={points.length > 6 ? "end" : "middle"} height={points.length > 6 ? 50 : 30} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={48} />
            {tooltip}
            <Bar dataKey="value" radius={[10, 10, 2, 2]}>
              {points.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
