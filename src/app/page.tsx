"use client";

import type { FormEvent } from "react";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Quote = { symbol: string; price: number | null };
type Position = { qty: number; cost: number };
type ChartResponse = { series: number[] };
type SymbolSearchResult = { symbol: string; name: string; exchange: string };
type ProfileRow = { user_id: string; username: string; league_code: string };
type PortfolioRow = {
  user_id: string;
  league_code: string;
  cash: number;
  positions: unknown;
  watchlist: unknown;
  selected_symbol: string;
};
type LeaderboardEntry = { userId: string; username: string; cash: number; positions: Record<string, Position> };

const INITIAL_CASH = 1_000_000;
const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "TSLA", "NVDA"];

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 12, padding: 14 };

function formatMoney(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
}
function formatPct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function lineColor(v: number) {
  return v >= 0 ? "#0f9d58" : "#d93025";
}
function defaultPortfolio() {
  return { cash: INITIAL_CASH, positions: {} as Record<string, Position>, watchlist: [...DEFAULT_WATCHLIST], selectedSymbol: DEFAULT_WATCHLIST[0] };
}
function parsePositions(input: unknown): Record<string, Position> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, Position> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[A-Z0-9.-]+$/.test(k) || !v || typeof v !== "object") continue;
    const qty = Number((v as { qty?: unknown }).qty);
    const cost = Number((v as { cost?: unknown }).cost);
    if (Number.isFinite(qty) && Number.isFinite(cost) && qty >= 0 && cost >= 0) out[k] = { qty, cost };
  }
  return out;
}
function parseWatchlist(input: unknown) {
  if (!Array.isArray(input)) return [...DEFAULT_WATCHLIST];
  const xs = [...new Set(input.map((x) => String(x).trim().toUpperCase()).filter((s) => /^[A-Z0-9.-]+$/.test(s)))];
  return xs.length ? xs : [...DEFAULT_WATCHLIST];
}
function normalizePortfolio(row?: Partial<PortfolioRow> | null) {
  const base = defaultPortfolio();
  if (!row) return base;
  const watchlist = parseWatchlist(row.watchlist);
  const selected = typeof row.selected_symbol === "string" ? row.selected_symbol.toUpperCase() : "";
  return {
    cash: Number.isFinite(Number(row.cash)) ? Number(row.cash) : base.cash,
    positions: parsePositions(row.positions),
    watchlist,
    selectedSymbol: watchlist.includes(selected) ? selected : (watchlist[0] ?? base.selectedSymbol),
  };
}

function Sparkline({ data }: { data: number[] }) {
  const width = 320;
  const height = 120;
  if (data.length < 2) return <div style={{ ...box, color: "#666" }}>Not enough chart data</div>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * (width - 16) + 8},${height - 8 - ((v - min) / range) * (height - 16)}`)
    .join(" ");
  const delta = ((data[data.length - 1] - data[0]) / (data[0] || 1)) * 100;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height, border: "1px solid #eee", borderRadius: 10 }}>
      <polyline fill="none" stroke={lineColor(delta)} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

export default function Home() {
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [leagueCodeInput, setLeagueCodeInput] = useState("friends5");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [cash, setCash] = useState(INITIAL_CASH);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_WATCHLIST[0]);
  const [newSymbol, setNewSymbol] = useState("");
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [chartSeries, setChartSeries] = useState<number[]>([]);
  const [status, setStatus] = useState("Loading quotes...");
  const [chartStatus, setChartStatus] = useState("Loading chart...");
  const [saveStatus, setSaveStatus] = useState("Not synced yet");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState("Login to view leaderboard");

  const activeSymbol = watchlist.includes(selectedSymbol) ? selectedSymbol : (watchlist[0] ?? "");
  const quoteUniverse = useMemo(() => {
    const set = new Set(watchlist);
    leaderboard.forEach((l) => Object.keys(l.positions).forEach((s) => set.add(s)));
    return [...set].slice(0, 30);
  }, [watchlist, leaderboard]);
  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    quotes.forEach((q) => typeof q.price === "number" && (m[q.symbol] = q.price));
    return m;
  }, [quotes]);

  function applyPortfolioState(p: ReturnType<typeof defaultPortfolio>) {
    setCash(p.cash);
    setPositions(p.positions);
    setWatchlist(p.watchlist);
    setSelectedSymbol(p.selectedSymbol);
    setQuotes([]);
    setChartSeries([]);
    setStatus("Loading quotes...");
    setChartStatus("Loading chart...");
  }

  const loadUserData = useEffectEvent(async (authUser: User) => {
    const s = getSupabaseBrowserClient();
    const [pr, po] = await Promise.all([
      s.from("profiles").select("user_id,username,league_code").eq("user_id", authUser.id).single(),
      s.from("portfolios").select("user_id,league_code,cash,positions,watchlist,selected_symbol").eq("user_id", authUser.id).maybeSingle(),
    ]);
    if (pr.error) {
      setProfile(null);
      setAuthMessage(pr.error.message);
      return;
    }
    setProfile(pr.data as ProfileRow);
    const normalized = normalizePortfolio((po.data as PortfolioRow | null) ?? null);
    applyPortfolioState(normalized);
    if (!po.data) {
      await s.from("portfolios").upsert({
        user_id: authUser.id,
        league_code: (pr.data as ProfileRow).league_code,
        cash: normalized.cash,
        positions: normalized.positions,
        watchlist: normalized.watchlist,
        selected_symbol: normalized.selectedSymbol,
      });
    }
    setSaveStatus("Synced");
  });

  useEffect(() => {
    const t = setTimeout(() => {
      if (!supabaseConfigured) {
        setHydrated(true);
        return;
      }
      const s = getSupabaseBrowserClient();
      void s.auth.getSession().then(({ data }) => {
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
        setHydrated(true);
      });
      s.auth.onAuthStateChange((_event, next) => {
        setSession(next);
        setUser(next?.user ?? null);
      });
    }, 0);
    return () => clearTimeout(t);
  }, [supabaseConfigured]);

  useEffect(() => {
    if (!hydrated || !user) {
      if (hydrated) {
        setProfile(null);
        setLeaderboard([]);
      }
      return;
    }
    const t = setTimeout(() => void loadUserData(user), 0);
    return () => clearTimeout(t);
  }, [hydrated, user]);

  const refreshQuotes = useEffectEvent(async () => {
    if (!user || quoteUniverse.length === 0) return;
    try {
      const params = new URLSearchParams({ symbols: quoteUniverse.join(",") });
      const r = await fetch(`/api/quotes?${params.toString()}`, { cache: "no-store" });
      const data = await r.json();
      setQuotes(data.quotes ?? []);
      setStatus(`Updated: ${new Date().toLocaleTimeString()}`);
    } catch {
      setStatus("Failed to load quotes.");
    }
  });

  const refreshChart = useEffectEvent(async (symbol: string) => {
    if (!user || !symbol) return;
    try {
      setChartStatus(`Loading ${symbol} chart...`);
      const r = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const data: ChartResponse = await r.json();
      setChartSeries(Array.isArray(data.series) ? data.series : []);
      setChartStatus(`Chart: ${symbol} (1h x 24)`);
    } catch {
      setChartStatus("Failed to load chart.");
      setChartSeries([]);
    }
  });

  const refreshLeaderboard = useEffectEvent(async () => {
    if (!user || !profile?.league_code) return;
    try {
      setLeaderboardStatus("Loading leaderboard...");
      const s = getSupabaseBrowserClient();
      const [prs, pos] = await Promise.all([
        s.from("profiles").select("user_id,username,league_code").eq("league_code", profile.league_code),
        s.from("portfolios").select("user_id,league_code,cash,positions").eq("league_code", profile.league_code),
      ]);
      if (prs.error) throw new Error(prs.error.message);
      if (pos.error) throw new Error(pos.error.message);
      const names = new Map<string, string>();
      ((prs.data ?? []) as ProfileRow[]).forEach((r) => names.set(r.user_id, r.username));
      const rows: LeaderboardEntry[] = ((pos.data ?? []) as PortfolioRow[]).map((r) => ({
        userId: r.user_id,
        username: names.get(r.user_id) ?? "Unknown",
        cash: Number(r.cash ?? INITIAL_CASH),
        positions: parsePositions(r.positions),
      }));
      setLeaderboard(rows);
      setLeaderboardStatus(`League: ${profile.league_code}`);
    } catch (e) {
      setLeaderboard([]);
      setLeaderboardStatus(e instanceof Error ? e.message : "Failed to load leaderboard");
    }
  });

  const savePortfolio = useEffectEvent(async () => {
    if (!user || !profile) return;
    try {
      setSaveStatus("Saving...");
      const s = getSupabaseBrowserClient();
      const { error } = await s.from("portfolios").upsert({
        user_id: user.id,
        league_code: profile.league_code,
        cash,
        positions,
        watchlist,
        selected_symbol: activeSymbol || watchlist[0] || "AAPL",
      });
      setSaveStatus(error ? `Save failed: ${error.message}` : `Synced ${new Date().toLocaleTimeString()}`);
    } catch {
      setSaveStatus("Save failed");
    }
  });

  useEffect(() => {
    if (!user) return;
    const t0 = setTimeout(() => void refreshQuotes(), 0);
    const t = setInterval(() => void refreshQuotes(), 15000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [user, quoteUniverse]);
  useEffect(() => {
    if (!user) return;
    const t0 = setTimeout(() => void refreshChart(activeSymbol), 0);
    const t = setInterval(() => void refreshChart(activeSymbol), 60000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [user, activeSymbol]);
  useEffect(() => {
    if (!user || !profile?.league_code) return;
    const t0 = setTimeout(() => void refreshLeaderboard(), 0);
    const t = setInterval(() => void refreshLeaderboard(), 30000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [user, profile?.league_code]);
  useEffect(() => {
    if (!user || !profile) return;
    const t = setTimeout(() => void savePortfolio(), 500);
    return () => clearTimeout(t);
  }, [user, profile, cash, positions, watchlist, selectedSymbol, activeSymbol]);

  useEffect(() => {
    const q = newSymbol.trim();
    if (!user || !q) return;
    const t = setTimeout(() => {
      const run = async () => {
        try {
          setSearchStatus("Searching...");
          const r = await fetch(`/api/symbol-search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
          const data = await r.json();
          const results = Array.isArray(data.results) ? (data.results as SymbolSearchResult[]) : [];
          setSearchResults(results);
          setSearchStatus(results.length ? "" : "No results");
        } catch {
          setSearchStatus("Search failed");
          setSearchResults([]);
        }
      };
      void run();
    }, 250);
    return () => clearTimeout(t);
  }, [user, newSymbol]);

  function handleSymbolInputChange(v: string) {
    setNewSymbol(v);
    if (!v.trim()) {
      setSearchResults([]);
      setSearchStatus("");
    }
  }
  function addSymbolToWatchlist(input: string) {
    const s = input.trim().toUpperCase();
    if (!s || !/^[A-Z0-9.-]+$/.test(s)) return false;
    setWatchlist((prev) => (prev.includes(s) ? prev : [...prev, s]));
    setSelectedSymbol(s);
    setNewSymbol("");
    setSearchResults([]);
    setSearchStatus("");
    return true;
  }
  function addSymbol(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void addSymbolToWatchlist(newSymbol || searchResults[0]?.symbol || "");
  }
  function removeSymbol(symbol: string) {
    setWatchlist((prev) => {
      const next = prev.filter((s) => s !== symbol);
      return next.length ? next : [DEFAULT_WATCHLIST[0]];
    });
  }
  function buy(symbol: string) {
    const p = priceMap[symbol];
    if (!p) return alert("Price unavailable");
    if (cash < p) return alert("Not enough cash");
    setCash((c) => c - p);
    setPositions((prev) => {
      const cur = prev[symbol] ?? { qty: 0, cost: 0 };
      return { ...prev, [symbol]: { qty: cur.qty + 1, cost: cur.cost + p } };
    });
  }
  function sell(symbol: string) {
    const p = priceMap[symbol];
    const cur = positions[symbol] ?? { qty: 0, cost: 0 };
    if (!p) return alert("Price unavailable");
    if (cur.qty <= 0) return alert("No shares");
    setCash((c) => c + p);
    setPositions((prev) => {
      const pos = prev[symbol];
      if (!pos || pos.qty <= 0) return prev;
      const avg = pos.cost / pos.qty;
      const nextQty = pos.qty - 1;
      const next = { ...prev };
      if (nextQty <= 0) delete next[symbol];
      else next[symbol] = { qty: nextQty, cost: Math.max(0, pos.cost - avg) };
      return next;
    });
  }

  async function handleAuthSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabaseConfigured) return;
    const s = getSupabaseBrowserClient();
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const em = email.trim().toLowerCase();
      const league = leagueCodeInput.trim().toLowerCase();
      const uname = usernameInput.trim();
      if (!em || !password) {
        setAuthMessage("이메일/비밀번호를 입력하세요.");
        return;
      }
      if (authMode === "signup") {
        if (!/^[A-Za-z0-9_.-]{3,20}$/.test(uname)) return setAuthMessage("닉네임 형식 오류");
        if (!/^[A-Za-z0-9_-]{3,32}$/.test(league)) return setAuthMessage("리그 코드 형식 오류");
        const { data, error } = await s.auth.signUp({ email: em, password });
        if (error) return setAuthMessage(error.message);
        if (!data.user || !data.session) {
          return setAuthMessage("이메일 확인이 켜져 있으면 즉시 로그인되지 않습니다. (테스트용으로 이메일 확인 OFF 권장)");
        }
        const p = defaultPortfolio();
        const [r1, r2] = await Promise.all([
          s.from("profiles").upsert({ user_id: data.user.id, username: uname, league_code: league }),
          s.from("portfolios").upsert({
            user_id: data.user.id,
            league_code: league,
            cash: p.cash,
            positions: p.positions,
            watchlist: p.watchlist,
            selected_symbol: p.selectedSymbol,
          }),
        ]);
        if (r1.error) return setAuthMessage(r1.error.message);
        if (r2.error) return setAuthMessage(r2.error.message);
        setSession(data.session);
        setUser(data.user);
        setProfile({ user_id: data.user.id, username: uname, league_code: league });
        applyPortfolioState(p);
        setPassword("");
        return;
      }
      const { data, error } = await s.auth.signInWithPassword({ email: em, password });
      if (error) return setAuthMessage(error.message);
      setSession(data.session);
      setUser(data.user);
      setPassword("");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    if (!supabaseConfigured) return;
    await getSupabaseBrowserClient().auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    applyPortfolioState(defaultPortfolio());
    setLeaderboard([]);
    setLeaderboardStatus("Login to view leaderboard");
  }

  const portfolioRows = useMemo(
    () =>
      watchlist.map((symbol) => {
        const pos = positions[symbol] ?? { qty: 0, cost: 0 };
        const price = priceMap[symbol] ?? null;
        const avg = pos.qty > 0 ? pos.cost / pos.qty : 0;
        const marketValue = price && pos.qty > 0 ? price * pos.qty : 0;
        const pnl = pos.qty > 0 && price ? marketValue - pos.cost : 0;
        const pnlPct = pos.qty > 0 && pos.cost > 0 ? (pnl / pos.cost) * 100 : 0;
        return { symbol, price, qty: pos.qty, avg, marketValue, pnl, pnlPct };
      }),
    [watchlist, positions, priceMap]
  );
  const holdingRows = portfolioRows.filter((r) => r.qty > 0);
  const totalStockValue = holdingRows.reduce((s, r) => s + r.marketValue, 0);
  const totalAsset = cash + totalStockValue;
  const totalReturn = totalAsset - INITIAL_CASH;
  const totalReturnPct = (totalReturn / INITIAL_CASH) * 100;
  const totalInvestedCost = holdingRows.reduce((s, r) => s + r.avg * r.qty, 0);
  const chartDeltaPct = chartSeries.length > 1 && chartSeries[0] ? ((chartSeries[chartSeries.length - 1] - chartSeries[0]) / chartSeries[0]) * 100 : 0;

  const leaderboardRows = useMemo(
    () =>
      leaderboard
        .map((row) => {
          let stock = 0;
          for (const [sym, pos] of Object.entries(row.positions)) {
            const p = priceMap[sym];
            if (p) stock += p * pos.qty;
          }
          const asset = row.cash + stock;
          const profit = asset - INITIAL_CASH;
          return { ...row, stock, asset, profit, profitPct: (profit / INITIAL_CASH) * 100 };
        })
        .sort((a, b) => b.asset - a.asset),
    [leaderboard, priceMap]
  );

  if (!hydrated) return <main style={{ padding: 24 }}>Loading app...</main>;

  if (!supabaseConfigured) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Supabase setup needed</h1>
        <p>무료로 친구 5명이 각자 계정으로 쓰려면 Supabase Auth/DB 연결이 필요합니다.</p>
        <p>
          환경변수: <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
        </p>
        <p>
          SQL 실행: <code>supabase/schema.sql</code>
        </p>
      </main>
    );
  }

  if (!session || !user) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <section style={{ ...box, width: "100%", maxWidth: 480 }}>
          <h1 style={{ marginTop: 0 }}>Mock Invest</h1>
          <p style={{ color: "#555" }}>친구 5명이 각자 계정으로 로그인하고 같은 리그에서 경쟁합니다.</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setAuthMode("login")} style={{ padding: "8px 12px" }}>로그인</button>
            <button onClick={() => setAuthMode("signup")} style={{ padding: "8px 12px" }}>회원가입</button>
          </div>
          <form onSubmit={handleAuthSubmit} style={{ display: "grid", gap: 8 }}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" style={{ padding: 8 }} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" style={{ padding: 8 }} />
            {authMode === "signup" && (
              <>
                <input value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} placeholder="닉네임(랭킹 표시)" style={{ padding: 8 }} />
                <input value={leagueCodeInput} onChange={(e) => setLeagueCodeInput(e.target.value)} placeholder="리그 코드 (친구들과 동일하게)" style={{ padding: 8 }} />
              </>
            )}
            <button type="submit" disabled={authBusy} style={{ padding: 10 }}>
              {authBusy ? "처리 중..." : authMode === "login" ? "로그인" : "계정 만들기"}
            </button>
          </form>
          {authMessage && <div style={{ marginTop: 10, color: "#b91c1c" }}>{authMessage}</div>}
          <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>회원가입 때 같은 리그 코드를 입력하면 경쟁 리더보드를 공유합니다.</div>
        </section>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 1180, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Mock Invest</h1>
          <div style={{ color: "#555" }}>
            {profile?.username ?? user.email} · League: {profile?.league_code ?? "-"} · {status}
          </div>
          <div style={{ color: "#666" }}>{saveStatus}</div>
        </div>
        <button onClick={() => void handleLogout()} style={{ padding: "8px 12px" }}>로그아웃</button>
      </div>

      <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <div style={box}><div>Cash</div><strong>{formatMoney(cash)}</strong></div>
        <div style={box}><div>Stock Balance</div><strong>{formatMoney(totalStockValue)}</strong></div>
        <div style={box}><div>Total Asset</div><strong>{formatMoney(totalAsset)}</strong></div>
        <div style={box}><div>Total Return</div><strong style={{ color: lineColor(totalReturn) }}>{formatMoney(totalReturn)} ({formatPct(totalReturnPct)})</strong></div>
      </section>

      <section style={{ ...box, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>League Leaderboard</h2>
          <div style={{ color: "#666" }}>{leaderboardStatus}</div>
        </div>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {leaderboardRows.map((row, i) => (
            <div key={row.userId} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, display: "grid", gridTemplateColumns: "40px 1fr auto auto", gap: 10, background: row.userId === user.id ? "#fafafa" : "#fff" }}>
              <strong>{i + 1}</strong>
              <div><div style={{ fontWeight: 700 }}>{row.username}</div><div style={{ color: "#666", fontSize: 12 }}>Cash {formatMoney(row.cash)} · Stock {formatMoney(row.stock)}</div></div>
              <div>{formatMoney(row.asset)}</div>
              <div style={{ color: lineColor(row.profit) }}>{formatPct(row.profitPct)}</div>
            </div>
          ))}
          {leaderboardRows.length === 0 && <div style={{ color: "#666" }}>No members yet.</div>}
        </div>
      </section>

      <section style={{ ...box, marginTop: 16 }}>
        <h2 style={{ margin: 0 }}>Held Positions</h2>
        <div style={{ marginTop: 8, color: "#666" }}>Invested Cost: {formatMoney(totalInvestedCost)}</div>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {holdingRows.map((r) => (
            <div key={r.symbol} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
              <div><strong>{r.symbol}</strong><div style={{ color: "#666" }}>Qty {r.qty}</div></div>
              <div>Avg {formatMoney(r.avg)}</div>
              <div>Current {r.price !== null ? formatMoney(r.price) : "Loading..."}</div>
              <div>Value {formatMoney(r.marketValue)}</div>
              <div style={{ color: lineColor(r.pnl) }}>P/L {formatMoney(r.pnl)}</div>
              <div style={{ color: lineColor(r.pnl) }}>Return {formatPct(r.pnlPct)}</div>
            </div>
          ))}
          {holdingRows.length === 0 && <div style={{ color: "#666" }}>No holdings yet.</div>}
        </div>
      </section>

      <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
        <div style={box}>
          <h2 style={{ marginTop: 0 }}>Watchlist</h2>
          <form onSubmit={addSymbol} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={newSymbol} onChange={(e) => handleSymbolInputChange(e.target.value)} placeholder="Search stock" style={{ padding: 8, flex: 1, minWidth: 180 }} />
            <button type="submit" style={{ padding: "8px 12px" }}>Add</button>
          </form>
          {(searchStatus || searchResults.length > 0) && (
            <div style={{ border: "1px solid #eee", borderRadius: 8, marginTop: 8, maxHeight: 200, overflow: "auto" }}>
              {searchStatus && searchResults.length === 0 ? (
                <div style={{ padding: 8, color: "#666" }}>{searchStatus}</div>
              ) : (
                searchResults.map((item) => (
                  <button key={`${item.symbol}-${item.exchange}-${item.name}`} type="button" onClick={() => void addSymbolToWatchlist(item.symbol)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #f4f4f4", padding: 8, background: "#fff", cursor: "pointer" }}>
                    <div style={{ fontWeight: 700 }}>{item.symbol}</div>
                    <div style={{ color: "#666", fontSize: 12 }}>{[item.name, item.exchange].filter(Boolean).join(" | ")}</div>
                  </button>
                ))
              )}
            </div>
          )}
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {portfolioRows.map((r) => (
              <div key={r.symbol} style={{ border: r.symbol === activeSymbol ? "2px solid #111" : "1px solid #eee", borderRadius: 8, padding: 10, display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                <div onClick={() => setSelectedSymbol(r.symbol)} role="button" tabIndex={0} style={{ cursor: "pointer" }} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelectedSymbol(r.symbol))}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{r.symbol}</strong>
                    <button type="button" onClick={(e) => (e.stopPropagation(), removeSymbol(r.symbol))} style={{ border: "none", background: "#f3f3f3", borderRadius: 6, padding: "2px 6px", cursor: "pointer" }}>x</button>
                  </div>
                  <div style={{ color: "#555" }}>Price: {r.price !== null ? formatMoney(r.price) : "Loading..."}</div>
                  <div style={{ color: "#555" }}>Qty: {r.qty} | Avg: {r.qty ? formatMoney(r.avg) : "-"}</div>
                  <div style={{ color: "#555" }}>
                    Value: {formatMoney(r.marketValue)} |{" "}
                    <span style={{ color: lineColor(r.pnl) }}>P/L {formatMoney(r.pnl)} ({formatPct(r.pnlPct)})</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button onClick={() => buy(r.symbol)} style={{ padding: "8px 10px" }}>Buy 1</button>
                  <button onClick={() => sell(r.symbol)} style={{ padding: "8px 10px" }}>Sell 1</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={box}>
          <h2 style={{ marginTop: 0 }}>Chart {activeSymbol ? `- ${activeSymbol}` : ""}</h2>
          <div style={{ color: "#555" }}>{chartStatus}</div>
          <div style={{ color: lineColor(chartDeltaPct), marginTop: 4 }}>
            {chartSeries.length > 1 ? `24h change: ${formatPct(chartDeltaPct)}` : "No chart change data"}
          </div>
          <div style={{ marginTop: 10 }}><Sparkline data={chartSeries} /></div>
          <div style={{ marginTop: 8, color: "#555" }}>Current: {activeSymbol && priceMap[activeSymbol] ? formatMoney(priceMap[activeSymbol]) : "-"}</div>
        </div>
      </section>
    </main>
  );
}
