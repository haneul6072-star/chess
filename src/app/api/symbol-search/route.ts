import { NextRequest, NextResponse } from "next/server";

type TwelveDataSearchRow = {
  symbol?: string;
  instrument_name?: string;
  exchange?: string;
};

export async function GET(req: NextRequest) {
  const key = process.env.TWELVEDATA_API_KEY;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  if (!key) {
    return NextResponse.json(
      { error: "TWELVEDATA_API_KEY is missing in .env.local" },
      { status: 500 }
    );
  }

  const url =
    `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}` +
    `&apikey=${encodeURIComponent(key)}`;

  const r = await fetch(url, { cache: "no-store" });
  const data = await r.json();
  const rows = Array.isArray(data?.data) ? (data.data as TwelveDataSearchRow[]) : [];

  const results = rows
    .filter((row) => row.symbol)
    .slice(0, 8)
    .map((row) => ({
      symbol: String(row.symbol).toUpperCase(),
      name: row.instrument_name ?? "",
      exchange: row.exchange ?? "",
    }));

  return NextResponse.json({ results });
}
