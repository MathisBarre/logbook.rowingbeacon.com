import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface DataItem {
  month: number;
  amount: number;
  label: string;
}

interface StackedBarChartProps {
  data: DataItem[];
}

export const StackedBarChart: React.FC<StackedBarChartProps> = ({ data }) => {
  // Transform data for stacked bar chart
  const transformedData = React.useMemo(() => {
    // Group data by month
    const monthlyData = data.reduce((acc, item) => {
      const monthKey = item.month;
      if (!acc[monthKey]) {
        acc[monthKey] = { month: monthKey };
      }
      acc[monthKey][item.label] = item.amount;
      return acc;
    }, {} as Record<number, any>);

    // Convert to array and sort by month
    return Object.values(monthlyData).sort((a, b) => a.month - b.month);
  }, [data]);

  // Get unique labels for the stacks
  const uniqueLabels = React.useMemo(() => {
    return Array.from(new Set(data.map((item) => item.label)));
  }, [data]);

  // Generate colors for each stack
  const colors = React.useMemo(() => {
    return uniqueLabels.map((_, index) => {
      const hue = (index * 137.5) % 360; // Golden angle approximation for good color distribution
      return `hsl(${hue}, 70%, 50%)`;
    });
  }, [uniqueLabels]);

  return (
    <div style={{ width: "100%", height: 400 }}>
      <ResponsiveContainer>
        <BarChart
          data={transformedData}
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickFormatter={(value: number) => `Month ${value}`}
          />
          <YAxis />
          <Tooltip />
          <Legend />
          {uniqueLabels.map((label, index) => (
            <Bar
              key={label}
              dataKey={label}
              stackId="a"
              fill={colors[index]}
              name={label}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
