"use client";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const PALETTE = ["#1f6f4a", "#c2603a", "#3b6ea8", "#b08a1e", "#7a4f9a", "#3f8f8a", "#a8435f", "#6b7b3a", "#8a6a4f", "#4f5d75", "#c48a9b", "#2e2e2e"];
type Point = { label: string; value: number };
const fmt = (v: unknown) => `$${Number(v).toFixed(2)}`;

export default function Chart({ type, points }: { type: "bar" | "pie" | "line"; points: Point[] }) {
  const tooltip = <Tooltip formatter={fmt} contentStyle={{ borderRadius: 8, border: "1px solid #e4ded1", fontSize: 12 }} />;
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {type === "pie" ? (
          <PieChart>
            <Pie data={points} dataKey="value" nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={2}
                 label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`} labelLine={false} fontSize={11}>
              {points.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            {tooltip}
          </PieChart>
        ) : type === "line" ? (
          <LineChart data={points} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid stroke="#ece6da" vertical={false} />
            <XAxis dataKey="label" fontSize={11} tickLine={false} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={48} />
            {tooltip}
            <Line type="monotone" dataKey="value" stroke="#1f6f4a" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        ) : (
          <BarChart data={points} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid stroke="#ece6da" vertical={false} />
            <XAxis dataKey="label" fontSize={11} tickLine={false} interval={0} angle={points.length > 6 ? -30 : 0} textAnchor={points.length > 6 ? "end" : "middle"} height={points.length > 6 ? 50 : 30} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={48} />
            {tooltip}
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {points.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
