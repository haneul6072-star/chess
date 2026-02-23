"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  choosePromotionDefault,
  createInitialSnapshot,
  encodeBoard,
  legalTargetSquares,
  makeMove,
  needsPromotionChoice,
  parseSquare,
  pieceChar,
  snapshotFromRemoteParts,
  snapshotState,
  sqName,
  statusText,
  type Color,
  type Coord,
  type GameStatus,
  type Snapshot,
} from "@/lib/chess";

type ProfileRow = { user_id: string; username: string };
type GameRow = {
  id: string;
  join_code: string;
  white_user_id: string;
  black_user_id: string | null;
  board: unknown;
  state: unknown;
  turn: Color;
  status: GameStatus;
  winner: Color | null;
  history: unknown;
  last_move: unknown;
  updated_at: string;
};
type GameListRow = Pick<GameRow, "id" | "join_code" | "white_user_id" | "black_user_id" | "turn" | "status" | "winner" | "updated_at">;

const files = "abcdefgh";
const styles: Record<string, CSSProperties> = {
  app: { minHeight: "100vh", background: "#f5f7fb", color: "#111827", padding: 16, fontFamily: "system-ui, sans-serif" },
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, boxShadow: "0 6px 20px rgba(17,24,39,.05)" },
  row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  input: { border: "1px solid #d1d5db", borderRadius: 10, padding: "9px 11px", width: "100%" },
  btn: { border: "1px solid #d1d5db", borderRadius: 10, padding: "9px 11px", background: "#fff", cursor: "pointer", fontWeight: 600 },
  btnP: { border: "1px solid #111827", borderRadius: 10, padding: "9px 11px", background: "#111827", color: "#fff", cursor: "pointer", fontWeight: 600 },
};

function joinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function myColor(game: GameRow | null, user: User | null): Color | null {
  if (!game || !user) return null;
  if (game.white_user_id === user.id) return "w";
  if (game.black_user_id === user.id) return "b";
  return null;
}

function remoteSnapshot(game: GameRow): Snapshot {
  return snapshotFromRemoteParts(game.board, game.turn, game.status, game.winner, game.history, game.last_move, game.state);
}

function BoardView({
  snap,
  playerColor,
  onMove,
  disabled,
}: {
  snap: Snapshot;
  playerColor: Color | null;
  onMove: (from: Coord, to: Coord, promotion?: "q" | "r" | "b" | "n") => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);

  const click = (r: number, c: number) => {
    if (disabled) return;
    const cell = sqName(r, c);
    const from = selected ? parseSquare(selected) : null;
    if (from && targets.includes(cell)) {
      let promotion: "q" | "r" | "b" | "n" | undefined;
      if (needsPromotionChoice(snap, from, { r, c })) {
       const parsed = choosePromotionDefault(input);
if (!parsed || parsed === "p" || parsed === "k") return;
promotion = parsed;

      }
      onMove(from, { r, c }, promotion);
      return;
    }
    const piece = snap.board[r][c];
    if (!piece || piece.c !== snap.turn || snap.status !== "playing" || (playerColor && piece.c !== playerColor)) {
      setSelected(null);
      setTargets([]);
      return;
    }
    setSelected(cell);
    setTargets(legalTargetSquares(snap, r, c));
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(40px, 54px))", width: "fit-content", border: "2px solid #111827", borderRadius: 10, overflow: "hidden" }}>
        {snap.board.map((row, r) =>
          row.map((piece, c) => {
            const cell = sqName(r, c);
            const dark = (r + c) % 2 === 1;
            const isTarget = targets.includes(cell);
            const isSelected = selected === cell;
            const isLast = !!snap.last && (snap.last.from === cell || snap.last.to === cell);
            let bg = dark ? "#b58863" : "#f0d9b5";
            if (isLast) bg = dark ? "#d3b13f" : "#f7e27d";
            if (isSelected) bg = "#60a5fa";
            if (isTarget) bg = piece ? "#fca5a5" : "#86efac";
            return (
              <button
                key={cell}
                type="button"
                onClick={() => click(r, c)}
                style={{ width: "min(12vw,54px)", height: "min(12vw,54px)", minWidth: 40, minHeight: 40, border: "none", background: bg, padding: 0, fontSize: 30, cursor: disabled ? "not-allowed" : "pointer" }}
              >
                {pieceChar(piece)}
              </button>
            );
          })
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(40px, 54px))", width: "fit-content", marginTop: 4, fontSize: 12, color: "#6b7280", textAlign: "center" }}>
        {files.split("").map((f) => <div key={f}>{f}</div>)}
      </div>
    </div>
  );
}

export default function Home() {
  const supabaseOk = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const [mode, setMode] = useState<"local" | "remote">("local");

  const [localSnap, setLocalSnap] = useState<Snapshot>(createInitialSnapshot);
  const [localMsg, setLocalMsg] = useState("Pass-and-play mode on one computer.");

  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState("");

  const [remoteGame, setRemoteGame] = useState<GameRow | null>(null);
  const [remoteSnap, setRemoteSnap] = useState<Snapshot | null>(null);
  const [remoteMsg, setRemoteMsg] = useState("Login to create or join a remote game.");
  const [joinInput, setJoinInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [myGames, setMyGames] = useState<GameListRow[]>([]);
  const gameId = remoteGame?.id ?? null;

  useEffect(() => {
    if (!supabaseOk) {
      setHydrated(true);
      return;
    }
    const s = getSupabaseBrowserClient();
    void s.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setHydrated(true);
    });
    const { data: sub } = s.auth.onAuthStateChange((_e, next) => {
      setSession(next);
      setUser(next?.user ?? null);
      if (!next) {
        setProfile(null);
        setRemoteGame(null);
        setRemoteSnap(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [supabaseOk]);

  useEffect(() => {
    if (!user || !supabaseOk) return;
    const s = getSupabaseBrowserClient();
    void s.from("profiles").select("user_id,username").eq("user_id", user.id).maybeSingle().then(({ data }) => setProfile((data as ProfileRow | null) ?? null));
  }, [user, supabaseOk]);

  useEffect(() => {
    if (!user || !supabaseOk || mode !== "remote") return;
    const s = getSupabaseBrowserClient();
    const load = async () => {
      const { data } = await s
        .from("chess_games")
        .select("id,join_code,white_user_id,black_user_id,turn,status,winner,updated_at")
        .or(`white_user_id.eq.${user.id},black_user_id.eq.${user.id}`)
        .order("updated_at", { ascending: false })
        .limit(20);
      setMyGames((data ?? []) as GameListRow[]);
    };
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [user, supabaseOk, mode]);

  useEffect(() => {
    if (!user || !supabaseOk || mode !== "remote" || !gameId) return;
    const s = getSupabaseBrowserClient();
    const load = async () => {
      const { data, error } = await s.from("chess_games").select("*").eq("id", gameId).single();
      if (error) {
        setRemoteMsg(error.message);
        return;
      }
      const row = data as GameRow;
      setRemoteGame(row);
      setRemoteSnap(remoteSnapshot(row));
    };
    void load();
    const t = setInterval(() => void load(), 1200);
    return () => clearInterval(t);
  }, [user, supabaseOk, mode, gameId]);

  const localMoves = useMemo(
    () => (localSnap.history.length ? localSnap.history.slice(-10).map((m, i) => `${localSnap.history.length - Math.min(10, localSnap.history.length) + i + 1}. ${m.from}-${m.to}`).join("  ") : "No moves yet."),
    [localSnap.history]
  );
  const remoteMoves = useMemo(
    () => (remoteSnap?.history.length ? remoteSnap.history.slice(-10).map((m, i) => `${remoteSnap.history.length - Math.min(10, remoteSnap.history.length) + i + 1}. ${m.from}-${m.to}`).join("  ") : "No moves yet."),
    [remoteSnap]
  );

  function playLocal(from: Coord, to: Coord, promotion?: "q" | "r" | "b" | "n") {
    const next = makeMove(localSnap, from, to, promotion);
    if (!next) return;
    setLocalSnap(next);
    setLocalMsg(next.status === "playing" ? "Move applied." : `Game over: ${statusText(next)}`);
  }

  async function authSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabaseOk) return;
    setAuthBusy(true);
    setAuthMsg("");
    const s = getSupabaseBrowserClient();
    try {
      const em = email.trim().toLowerCase();
      if (!em || !password) return void setAuthMsg("Email and password are required.");
      if (authMode === "signup") {
        const name = username.trim();
        if (!/^[A-Za-z0-9_.-]{3,20}$/.test(name)) return void setAuthMsg("Username must be 3-20 chars (letters/numbers/._-).");
        const { data, error } = await s.auth.signUp({ email: em, password });
        if (error) return void setAuthMsg(error.message);
        if (data.user) {
          const { error: pErr } = await s.from("profiles").upsert({ user_id: data.user.id, username: name });
          if (pErr) return void setAuthMsg(pErr.message);
        }
      } else {
        const { error } = await s.auth.signInWithPassword({ email: em, password });
        if (error) return void setAuthMsg(error.message);
      }
      setPassword("");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    if (!supabaseOk) return;
    await getSupabaseBrowserClient().auth.signOut();
  }

  async function createRemoteGame() {
    if (!user || !supabaseOk) return;
    setBusy(true);
    setRemoteMsg("Creating game...");
    try {
      const s = getSupabaseBrowserClient();
      const snap = createInitialSnapshot();
      for (let i = 0; i < 5; i += 1) {
        const payload = {
          join_code: joinCode(),
          white_user_id: user.id,
          black_user_id: null,
          board: encodeBoard(snap.board),
          state: snapshotState(snap),
          turn: snap.turn,
          status: snap.status,
          winner: snap.winner,
          history: snap.history,
          last_move: snap.last,
        };
        const { data, error } = await s.from("chess_games").insert(payload).select("*").single();
        if (!error && data) {
          const row = data as GameRow;
          setRemoteGame(row);
          setRemoteSnap(remoteSnapshot(row));
          setRemoteMsg(`Game created. Share code ${row.join_code}`);
          return;
        }
      }
      setRemoteMsg("Failed to create game.");
    } finally {
      setBusy(false);
    }
  }

  async function joinRemoteGame() {
    if (!user || !supabaseOk) return;
    const code = joinInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(code)) return void setRemoteMsg("Invalid join code.");
    setBusy(true);
    setRemoteMsg("Joining game...");
    try {
      const s = getSupabaseBrowserClient();
      const { data, error } = await s.from("chess_games").select("*").eq("join_code", code).maybeSingle();
      if (error) return void setRemoteMsg(error.message);
      const row = data as GameRow | null;
      if (!row) return void setRemoteMsg("Game not found.");
      if (row.white_user_id === user.id || row.black_user_id === user.id) {
        setRemoteGame(row);
        setRemoteSnap(remoteSnapshot(row));
        setRemoteMsg(`Connected to ${row.join_code}`);
        return;
      }
      if (row.black_user_id) return void setRemoteMsg("Game already has two players.");
      const { data: joined, error: joinErr } = await s
        .from("chess_games")
        .update({ black_user_id: user.id })
        .eq("id", row.id)
        .is("black_user_id", null)
        .select("*")
        .single();
      if (joinErr) return void setRemoteMsg(joinErr.message);
      const jr = joined as GameRow;
      setRemoteGame(jr);
      setRemoteSnap(remoteSnapshot(jr));
      setRemoteMsg(`Joined ${jr.join_code}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadGame(id: string) {
    if (!supabaseOk) return;
    const s = getSupabaseBrowserClient();
    const { data, error } = await s.from("chess_games").select("*").eq("id", id).single();
    if (error) return void setRemoteMsg(error.message);
    const row = data as GameRow;
    setRemoteGame(row);
    setRemoteSnap(remoteSnapshot(row));
    setRemoteMsg(`Loaded ${row.join_code}`);
  }

  async function playRemote(from: Coord, to: Coord, promotion?: "q" | "r" | "b" | "n") {
    if (!user || !supabaseOk || !remoteGame || !remoteSnap) return;
    const color = myColor(remoteGame, user);
    if (!color) return void setRemoteMsg("You are not a player in this game.");
    if (remoteSnap.turn !== color) return void setRemoteMsg("Not your turn.");

    const next = makeMove(remoteSnap, from, to, promotion);
    if (!next) return;

    setBusy(true);
    setRemoteMsg("Sending move...");
    try {
      const s = getSupabaseBrowserClient();
      const { data, error } = await s
        .from("chess_games")
        .update({
          board: encodeBoard(next.board),
          state: snapshotState(next),
          turn: next.turn,
          status: next.status,
          winner: next.winner,
          history: next.history,
          last_move: next.last,
        })
        .eq("id", remoteGame.id)
        .eq("turn", remoteSnap.turn)
        .select("*")
        .single();
      if (error) return void setRemoteMsg(error.message);
      const row = data as GameRow;
      setRemoteGame(row);
      setRemoteSnap(remoteSnapshot(row));
      setRemoteMsg(next.status === "playing" ? "Move sent." : `Game over: ${statusText(next)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return <main style={styles.app}>Loading...</main>;

  return (
    <main style={{ ...styles.app, maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ ...styles.card, marginBottom: 14 }}>
        <div style={{ ...styles.row, justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30 }}>Chess With Friends</h1>
            <div style={{ color: "#4b5563", marginTop: 6 }}>Remote 1v1 + pass-and-play on one computer. Full core rules added.</div>
          </div>
          <div style={styles.row}>
            <button type="button" style={mode === "local" ? styles.btnP : styles.btn} onClick={() => setMode("local")}>Local</button>
            <button type="button" style={mode === "remote" ? styles.btnP : styles.btn} onClick={() => setMode("remote")}>Remote</button>
          </div>
        </div>
      </div>

      {mode === "local" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,520px) 1fr", gap: 14, alignItems: "start" }}>
          <div style={styles.card}>
            <BoardView key={`${localSnap.history.length}-${localSnap.turn}-${localSnap.status}`} snap={localSnap} playerColor={null} onMove={playLocal} />
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={styles.card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Local Game</div>
              <div>{statusText(localSnap)}</div>
              <div style={{ color: "#4b5563", marginTop: 8 }}>{localMsg}</div>
              <div style={{ marginTop: 10 }}>
                <button type="button" style={styles.btnP} onClick={() => { setLocalSnap(createInitialSnapshot()); setLocalMsg("New local game started."); }}>New Game</button>
              </div>
            </div>
            <div style={styles.card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent Moves</div>
              <div style={{ color: "#4b5563", lineHeight: 1.6, wordBreak: "break-word" }}>{localMoves}</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,520px) 1fr", gap: 14, alignItems: "start" }}>
          <div style={styles.card}>
            {remoteSnap ? (
              <>
                <BoardView key={`${remoteSnap.history.length}-${remoteSnap.turn}-${remoteSnap.status}`} snap={remoteSnap} playerColor={myColor(remoteGame, user)} onMove={(f, t, p) => void playRemote(f, t, p)} disabled={busy} />
                <div style={{ marginTop: 10 }}>{statusText(remoteSnap)}</div>
              </>
            ) : (
              <div style={{ color: "#6b7280" }}>Create or load a remote game to see the board.</div>
            )}
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <div style={styles.card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Remote Match</div>
              {!supabaseOk ? (
                <div style={{ color: "#92400e" }}>Set Supabase env vars and run `supabase/schema.sql` first.</div>
              ) : !session || !user ? (
                <>
                  <div style={{ ...styles.row, marginBottom: 8 }}>
                    <button type="button" style={authMode === "login" ? styles.btnP : styles.btn} onClick={() => setAuthMode("login")}>Login</button>
                    <button type="button" style={authMode === "signup" ? styles.btnP : styles.btn} onClick={() => setAuthMode("signup")}>Sign up</button>
                  </div>
                  <form onSubmit={authSubmit} style={{ display: "grid", gap: 8 }}>
                    <input style={styles.input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <input style={styles.input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    {authMode === "signup" && <input style={styles.input} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />}
                    <button type="submit" style={styles.btnP} disabled={authBusy}>{authBusy ? "Working..." : authMode === "login" ? "Login" : "Create account"}</button>
                  </form>
                  {authMsg && <div style={{ color: "#b91c1c", marginTop: 8 }}>{authMsg}</div>}
                </>
              ) : (
                <>
                  <div style={{ ...styles.row, justifyContent: "space-between" }}>
                    <strong>{profile?.username ?? user.email}</strong>
                    <button type="button" style={styles.btn} onClick={() => void logout()}>Logout</button>
                  </div>
                  <div style={{ color: "#4b5563", marginTop: 8 }}>{remoteMsg}</div>
                  <div style={{ ...styles.row, marginTop: 10 }}>
                    <button type="button" style={styles.btnP} disabled={busy} onClick={() => void createRemoteGame()}>Create Game (White)</button>
                  </div>
                  <div style={{ ...styles.row, marginTop: 10 }}>
                    <input style={{ ...styles.input, flex: 1 }} placeholder="Join code" value={joinInput} onChange={(e) => setJoinInput(e.target.value.toUpperCase())} />
                    <button type="button" style={styles.btn} disabled={busy} onClick={() => void joinRemoteGame()}>Join</button>
                  </div>
                </>
              )}
            </div>

            {session && user && supabaseOk && (
              <>
                <div style={styles.card}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Current Game</div>
                  {!remoteGame || !remoteSnap ? (
                    <div style={{ color: "#6b7280" }}>None selected.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, color: "#374151" }}>
                      <div>Code: <code>{remoteGame.join_code}</code></div>
                      <div>Your color: {myColor(remoteGame, user) === "w" ? "White" : myColor(remoteGame, user) === "b" ? "Black" : "Spectator"}</div>
                      <div>Players: {remoteGame.black_user_id ? "2/2" : "1/2 (waiting for Black)"}</div>
                      <div>Last update: {new Date(remoteGame.updated_at).toLocaleString()}</div>
                      <div>Recent moves: {remoteMoves}</div>
                    </div>
                  )}
                </div>
                <div style={styles.card}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>My Recent Games</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {myGames.map((g) => (
                      <button key={g.id} type="button" onClick={() => void loadGame(g.id)} style={{ ...styles.btn, textAlign: "left", padding: 10, background: remoteGame?.id === g.id ? "#eff6ff" : "#fff" }}>
                        <div style={{ ...styles.row, justifyContent: "space-between" }}>
                          <strong>{g.join_code}</strong>
                          <span style={{ color: "#6b7280", fontSize: 12 }}>{new Date(g.updated_at).toLocaleString()}</span>
                        </div>
                        <div style={{ color: "#4b5563", marginTop: 4 }}>
                          {g.status === "playing" ? "In progress" : g.status === "checkmate" ? `Checkmate (${g.winner === "w" ? "White" : "Black"} wins)` : g.status === "stalemate" ? "Stalemate" : "Draw"}
                        </div>
                      </button>
                    ))}
                    {myGames.length === 0 && <div style={{ color: "#6b7280" }}>No games yet.</div>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
