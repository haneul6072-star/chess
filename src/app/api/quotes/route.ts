import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "TSLA", "NVDA", "AMZN", "GOOGL", "META"];
const MAX_SYMBOLS = 10;

function parseSymbols(input: string | null) {
  const raw = (input ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const unique = [...new Set(raw)];
  const valid = unique.filter((s) => /^[A-Z0-9.-]+$/.test(s));

  if (valid.length === 0) return DEFAULT_SYMBOLS;
  return valid.slice(0, MAX_SYMBOLS);
}

export async function GET(req: NextRequest) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "TWELVEDATA_API_KEY is missing in .env.local" },
      { status: 500 }
    );
  }

  const symbols = parseSymbols(req.nextUrl.searchParams.get("symbols"));

  // ✅ 여러 종목을 한 번에 요청 (호출수 절약)
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(
    symbols.join(",")
  )}&apikey=${encodeURIComponent(key)}`;

  const r = await fetch(url, { cache: "no-store" });
  const data = await r.json();

  // TwelveData 에러면 그대로 반환
  if (data?.status === "error") {
    return NextResponse.json({ quotes: [], symbols, error: data }, { status: 200 });
  }

  // ✅ { AAPL: {...}, MSFT: {...} } 형태로 오는 경우가 많음
  const quotes = symbols.map((symbol) => {
    const row = data?.[symbol];
    const price =
      row?.close ??
      row?.price ??
      row?.last ??
      row?.open ??
      row?.high ??
      row?.low ??
      null;

    return { symbol, price: price !== null ? Number(price) : null };
  });

  return NextResponse.json({ quotes, symbols });
}