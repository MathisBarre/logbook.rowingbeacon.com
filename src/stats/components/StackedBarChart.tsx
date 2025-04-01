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

export interface BarChartStackItem {
  month: number;
  stackAmount: number;
  stackLabel: string;
}

interface StackedBarChartProps {
  data: BarChartStackItem[];
  formatMonth?: (month: number) => string;
  formatAmount?: (amount: number) => string;
  sortStacks?: (a: string, b: string) => number;
  formatStackLabel?: (label: string) => string;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    name: string;
    color: string;
  }>;
  label?: number;
}

export const StackedBarChart: React.FC<StackedBarChartProps> = ({
  data,
  formatMonth = (month) => `Month ${month}`,
  formatAmount = (amount) => amount.toString(),
  sortStacks,
  formatStackLabel,
}) => {
  // Transform data for stacked bar chart
  const transformedData = React.useMemo(() => {
    // Group data by month
    const monthlyData = data.reduce((acc, item) => {
      const monthKey = item.month;
      if (!acc[monthKey]) {
        acc[monthKey] = { month: monthKey } as Record<string, number>;
      }
      acc[monthKey][item.stackLabel] = item.stackAmount;
      return acc;
    }, {} as Record<number, Record<string, number>>);

    // Convert to array and sort by month, starting from August (8)
    return Object.values(monthlyData).sort((a, b) => {
      // Adjust month comparison to start from August
      const monthA = a.month >= 7 ? a.month : a.month + 12;
      const monthB = b.month >= 7 ? b.month : b.month + 12;
      return monthA - monthB;
    });
  }, [data]);

  // Get unique labels for the stacks and sort them if sortStacks is provided
  const uniqueLabels = React.useMemo(() => {
    const labels = Array.from(new Set(data.map((item) => item.stackLabel)));
    if (sortStacks) {
      return labels.sort(sortStacks);
    }
    return labels;
  }, [data, sortStacks]);

  // Generate colors for each stack based on theme
  const colors = React.useMemo(() => {
    // Define base blue colors for each category
    const blueShades = [
      "#04BBFF",
      "#0594D0",
      "#0483B4",
      "#007198",
      "#005F7C",
      "#004C60",
      "#003C57",
      "#002A3E",
      "#051C24",
    ];

    return uniqueLabels.map((label, index) => {
      return blueShades[index];
    });
  }, [uniqueLabels]);

  const textColor = "#000";
  const gridColor = "#ddd";

  // Custom tooltip component
  const CustomTooltip: React.FC<TooltipProps> = ({
    active,
    payload,
    label,
  }) => {
    if (active && payload && payload.length) {
      const total = payload.reduce((sum, entry) => sum + entry.value, 0);

      return (
        <div
          style={{
            backgroundColor: "#fff",
            border: `1px solid #e5e7eb`,
            borderRadius: "4px",
            padding: "8px",
            color: textColor,
          }}
        >
          <p style={{ fontWeight: "bold", marginBottom: "4px" }}>
            {formatMonth(label || 0)}
          </p>
          <p style={{ marginBottom: "4px" }}>Total: {formatAmount(total)}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: {formatAmount(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
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
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="month"
            tickFormatter={formatMonth}
            tick={{ fill: textColor }}
          />
          <YAxis tickFormatter={formatAmount} tick={{ fill: textColor }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ color: textColor }} />
          {uniqueLabels.map((label, index) => (
            <Bar
              key={label}
              dataKey={label}
              stackId="a"
              fill={colors[index]}
              name={formatStackLabel ? formatStackLabel(label) : label}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
