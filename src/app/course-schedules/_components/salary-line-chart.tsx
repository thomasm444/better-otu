"use client";

import React, { useMemo, useState } from "react";

import type { ProfessorSalaryRecord } from "../types";

const BASE_START_YEAR = 2022;
const BASE_END_YEAR = 2025;

function formatCurrency(value: number): string {
  return value.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
}

function formatAxisK(value: number): string {
  if (value === 0) return "$0";
  const k = value / 1000;
  return Number.isInteger(k) ? `$${k}k` : `$${k.toFixed(0)}k`;
}

export function SalaryLineChart({
  salaries,
}: {
  salaries: ProfessorSalaryRecord[];
}) {
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);

  const { years, byYear, sortedRecords, yMin, yMax, yTicks } = useMemo(() => {
    const map = new Map<number, ProfessorSalaryRecord>();
    let maxRecordYear = BASE_END_YEAR;
    for (const rec of salaries) {
      if (!Number.isFinite(rec.calendarYear) || !Number.isFinite(rec.salaryPaid)) {
        continue;
      }
      if (rec.calendarYear > maxRecordYear) {
        maxRecordYear = rec.calendarYear;
      }
      const existing = map.get(rec.calendarYear);
      if (!existing || rec.salaryPaid > existing.salaryPaid) {
        map.set(rec.calendarYear, rec);
      }
    }

    const yearList: number[] = [];
    for (let y = BASE_START_YEAR; y <= maxRecordYear; y += 1) {
      yearList.push(y);
    }

    const records = Array.from(map.values()).sort(
      (a, b) => a.calendarYear - b.calendarYear,
    );

    if (records.length === 0) {
      return {
        years: yearList,
        byYear: map,
        sortedRecords: records,
        yMin: 100000,
        yMax: 200000,
        yTicks: [100000, 150000, 200000],
      };
    }

    const vals = records.map((r) => r.salaryPaid);
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);

    const minBound = Math.max(
      0,
      Math.floor((Math.min(rawMin, 100000) === rawMin ? rawMin - 10000 : rawMin - 15000) / 20000) *
        20000,
    );
    let maxBound = Math.ceil((rawMax + 15000) / 20000) * 20000;
    if (maxBound <= minBound) {
      maxBound = minBound + 40000;
    }

    const mid = Math.round((minBound + maxBound) / 2 / 1000) * 1000;

    return {
      years: yearList,
      byYear: map,
      sortedRecords: records,
      yMin: minBound,
      yMax: maxBound,
      yTicks: [minBound, mid, maxBound],
    };
  }, [salaries]);

  if (sortedRecords.length === 0) {
    return (
      <p className="mt-1 text-xs opacity-75">
        No Ontario Sunshine List records (2022–{BASE_END_YEAR}) for this instructor.
      </p>
    );
  }

  const latest = sortedRecords[sortedRecords.length - 1];
  const prev =
    sortedRecords.length >= 2 ? sortedRecords[sortedRecords.length - 2] : null;
  const delta = prev ? latest.salaryPaid - prev.salaryPaid : null;
  const deltaPct =
    prev && prev.salaryPaid > 0
      ? ((latest.salaryPaid - prev.salaryPaid) / prev.salaryPaid) * 100
      : null;

  const activeRecord =
    (hoveredYear !== null ? byYear.get(hoveredYear) : null) ?? latest;

  // SVG layout
  const width = 304;
  const height = 128;
  const padLeft = 42;
  const padRight = 14;
  const padTop = 12;
  const padBottom = 22;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const xForIndex = (idx: number) =>
    years.length <= 1
      ? padLeft + plotW / 2
      : padLeft + (idx / (years.length - 1)) * plotW;

  const yForValue = (val: number) => {
    const ratio = (val - yMin) / (yMax - yMin || 1);
    return padTop + plotH - ratio * plotH;
  };

  // Build contiguous line segments (skip missing years so gaps stay empty)
  const segments: Array<Array<{ year: number; x: number; y: number; rec: ProfessorSalaryRecord }>> = [];
  let currentSeg: Array<{ year: number; x: number; y: number; rec: ProfessorSalaryRecord }> = [];

  years.forEach((year, idx) => {
    const rec = byYear.get(year);
    if (rec) {
      currentSeg.push({
        year,
        x: xForIndex(idx),
        y: yForValue(rec.salaryPaid),
        rec,
      });
    } else if (currentSeg.length > 0) {
      segments.push(currentSeg);
      currentSeg = [];
    }
  });
  if (currentSeg.length > 0) {
    segments.push(currentSeg);
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold tabular-nums">
            {formatCurrency(activeRecord.salaryPaid)}
          </span>
          <span className="text-[10.5px] font-medium opacity-70">
            ({activeRecord.calendarYear})
          </span>
        </div>
        {hoveredYear === null && delta !== null && deltaPct !== null && (
          <span
            className={`text-[10px] font-semibold tabular-nums ${
              delta >= 0
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {delta >= 0 ? "+" : ""}
            {formatCurrency(delta)} ({delta >= 0 ? "+" : ""}
            {deltaPct.toFixed(1)}%)
          </span>
        )}
        {hoveredYear !== null && activeRecord.taxableBenefits > 0 && (
          <span className="text-[10px] opacity-70 tabular-nums">
            +{formatCurrency(activeRecord.taxableBenefits)} benefits
          </span>
        )}
      </div>

      {activeRecord.jobTitle && (
        <div className="truncate text-[10px] opacity-70" title={activeRecord.jobTitle}>
          {activeRecord.jobTitle}
        </div>
      )}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full select-none overflow-visible"
        role="img"
        aria-label={`Ontario Sunshine List salary chart from ${years[0]} to ${years[years.length - 1]}`}
        onMouseLeave={() => setHoveredYear(null)}
      >
        <defs>
          <linearGradient id="salaryAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-accent)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--brand-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines & Y-axis labels */}
        {yTicks.map((tick) => {
          const y = yForValue(tick);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.14}
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-current text-[9.5px] opacity-65 tabular-nums"
              >
                {formatAxisK(tick)}
              </text>
            </g>
          );
        })}

        {/* Contiguous area fills & lines (missing years remain empty) */}
        {segments.map((seg, sIdx) => {
          const linePath = seg
            .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`)
            .join(" ");
          const areaPath =
            seg.length >= 2
              ? `${linePath} L ${seg[seg.length - 1].x} ${padTop + plotH} L ${seg[0].x} ${padTop + plotH} Z`
              : null;
          return (
            <g key={sIdx}>
              {areaPath && <path d={areaPath} fill="url(#salaryAreaGrad)" />}
              {seg.length >= 2 && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="var(--brand-accent)"
                  strokeWidth={2.25}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </g>
          );
        })}

        {/* X-axis year labels & data points */}
        {years.map((year, idx) => {
          const x = xForIndex(idx);
          const rec = byYear.get(year);
          const isActive = activeRecord.calendarYear === year;
          return (
            <g key={year}>
              <text
                x={x}
                y={height - 5}
                textAnchor="middle"
                className={`fill-current text-[10px] tabular-nums ${
                  rec ? "font-semibold opacity-85" : "opacity-40"
                }`}
              >
                {year}
              </text>
              {rec && (
                <g>
                  {isActive && (
                    <circle
                      cx={x}
                      cy={yForValue(rec.salaryPaid)}
                      r={6}
                      fill="var(--brand-accent)"
                      fillOpacity={0.22}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={yForValue(rec.salaryPaid)}
                    r={isActive ? 3.75 : 3}
                    fill="var(--brand-accent)"
                    stroke="var(--bg-surface)"
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={x}
                    cy={yForValue(rec.salaryPaid)}
                    r={14}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredYear(year)}
                  />
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
