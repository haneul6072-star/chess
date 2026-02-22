import { NextRequest, NextResponse } from "next/server";

function toSeries(values: unknown): number[] {
  if (!Array.isArray(values)) return [];

  const points = values
    .map((item) => {
      const close = (item as { close?: string })?.close;
      const n = Number(close);
      return Number.isFinite(n) ? n : null;
    })
    .filter((n): n is number => n !== null);

  return points.reverse();
}

export async function GET(req: NextRequest) {
  const key = process.env.TWELVEDATA_API_KEY;
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "AAPL")
    .trim()
    .toUpperCase();

  if (!key) {
    return NextResponse.json(
      { error: "TWELVEDATA_API_KEY is missing in .env.local" },
      { status: 500 }
    );
  }

  if (!/^[A-Z0-9.-]+$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1h&outputsize=24&apikey=${encodeURIComponent(key)}`;
  const r = await fetch(url, { cache: "no-store" });
  const data = await r.json();
  const series = toSeries(data?.values);

  return NextResponse.json({
    symbol,
    series,
    meta: data?.meta ?? null,
    rawError: series.length === 0 ? data : null,
  });
}
