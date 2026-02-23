export type Color = "w" | "b";
export type PieceType = "p" | "r" | "n" | "b" | "q" | "k";
export type Piece = { c: Color; t: PieceType };
export type Board = (Piece | null)[][];
export type Coord = { r: number; c: number };
export type GameStatus = "playing" | "checkmate" | "stalemate" | "draw";
export type CastlingRights = { wk: boolean; wq: boolean; bk: boolean; bq: boolean };
export type MoveRecord = {
  from: string;
  to: string;
  turn: Color;
  piece: string;
  captured?: string;
  promotion?: PieceType;
  castle?: "k" | "q";
  enPassant?: boolean;
};
export type Snapshot = {
  board: Board;
  turn: Color;
  status: GameStatus;
  winner: Color | null;
  resultReason: string | null;
  history: MoveRecord[];
  last: { from: string; to: string } | null;
  castling: CastlingRights;
  enPassant: string | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  positionKeys: string[];
};
export type Move = {
  from: Coord;
  to: Coord;
  promotion?: PieceType;
  castle?: "k" | "q";
  enPassant?: boolean;
};

const FILES = "abcdefgh";
const KNIGHT = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as const;
const ROOK_DIRS = [[1,0],[-1,0],[0,1],[0,-1]] as const;
const BISHOP_DIRS = [[1,1],[1,-1],[-1,1],[-1,-1]] as const;
const QUEEN_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS] as const;

export const pieceGlyph: Record<string, string> = {
  wp: "\u2659", wr: "\u2656", wn: "\u2658", wb: "\u2657", wq: "\u2655", wk: "\u2654",
  bp: "\u265F", br: "\u265C", bn: "\u265E", bb: "\u265D", bq: "\u265B", bk: "\u265A",
};

export const sqName = (r: number, c: number) => `${FILES[c]}${8 - r}`;
export function parseSquare(s: string): Coord | null {
  if (!/^[a-h][1-8]$/.test(s)) return null;
  return { r: 8 - Number(s[1]), c: FILES.indexOf(s[0]) };
}
export const opposite = (c: Color): Color => (c === "w" ? "b" : "w");
const inb = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const code = (p: Piece | null) => (p ? `${p.c}${p.t}` : null);
const cloneBoard = (b: Board): Board => b.map((row) => row.map((p) => (p ? { ...p } : null)));

function initialBoard(): Board {
  const b: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back: PieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let c = 0; c < 8; c += 1) {
    b[0][c] = { c: "b", t: back[c] };
    b[1][c] = { c: "b", t: "p" };
    b[6][c] = { c: "w", t: "p" };
    b[7][c] = { c: "w", t: back[c] };
  }
  return b;
}

function initialCastling(): CastlingRights {
  return { wk: true, wq: true, bk: true, bq: true };
}

function boardKey(board: Board): string {
  return board.map((row) => row.map((p) => code(p) ?? "--").join("")).join("/");
}

function positionKey(board: Board, turn: Color, castling: CastlingRights, enPassant: string | null): string {
  const castle = `${castling.wk?"K":""}${castling.wq?"Q":""}${castling.bk?"k":""}${castling.bq?"q":""}` || "-";
  return `${boardKey(board)}|${turn}|${castle}|${enPassant ?? "-"}`;
}

export function createInitialSnapshot(): Snapshot {
  const board = initialBoard();
  const castling = initialCastling();
  const key = positionKey(board, "w", castling, null);
  return {
    board,
    turn: "w",
    status: "playing",
    winner: null,
    resultReason: null,
    history: [],
    last: null,
    castling,
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    positionKeys: [key],
  };
}

export function encodeBoard(board: Board): (string | null)[][] {
  return board.map((row) => row.map((p) => code(p)));
}

export function decodeBoard(value: unknown): Board {
  if (!Array.isArray(value) || value.length !== 8) return initialBoard();
  const b: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r += 1) {
    const row = value[r];
    if (!Array.isArray(row) || row.length !== 8) return initialBoard();
    for (let c = 0; c < 8; c += 1) {
      const q = row[c];
      if (q == null) continue;
      if (typeof q !== "string" || !/^[wb][prnbqk]$/.test(q)) return initialBoard();
      b[r][c] = { c: q[0] as Color, t: q[1] as PieceType };
    }
  }
  return b;
}

export function pieceChar(p: Piece | null): string {
  return p ? pieceGlyph[code(p) ?? ""] ?? "" : "";
}

function findKing(board: Board, color: Color): Coord | null {
  for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) if (board[r][c]?.c === color && board[r][c]?.t === "k") return { r, c };
  return null;
}

export function isSquareAttacked(board: Board, tr: number, tc: number, by: Color): boolean {
  const pd = by === "w" ? -1 : 1;
  for (const dc of [-1, 1]) {
    const r = tr - pd;
    const c = tc - dc;
    if (inb(r, c) && board[r][c]?.c === by && board[r][c]?.t === "p") return true;
  }
  for (const [dr, dc] of KNIGHT) {
    const r = tr + dr;
    const c = tc + dc;
    if (inb(r, c) && board[r][c]?.c === by && board[r][c]?.t === "n") return true;
  }
  for (const [dr, dc] of ROOK_DIRS) {
    let r = tr + dr; let c = tc + dc;
    while (inb(r, c)) {
      const p = board[r][c];
      if (p) { if (p.c === by && (p.t === "r" || p.t === "q")) return true; break; }
      r += dr; c += dc;
    }
  }
  for (const [dr, dc] of BISHOP_DIRS) {
    let r = tr + dr; let c = tc + dc;
    while (inb(r, c)) {
      const p = board[r][c];
      if (p) { if (p.c === by && (p.t === "b" || p.t === "q")) return true; break; }
      r += dr; c += dc;
    }
  }
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (!dr && !dc) continue;
      const r = tr + dr, c = tc + dc;
      if (inb(r, c) && board[r][c]?.c === by && board[r][c]?.t === "k") return true;
    }
  }
  return false;
}

export function isInCheck(board: Board, color: Color): boolean {
  const k = findKing(board, color);
  return k ? isSquareAttacked(board, k.r, k.c, opposite(color)) : false;
}

function canCastle(snapshot: Snapshot, color: Color, side: "k" | "q"): boolean {
  const row = color === "w" ? 7 : 0;
  const rights = snapshot.castling;
  const key = `${color}${side}` as "wk" | "wq" | "bk" | "bq";
  if (!rights[key]) return false;
  const king = snapshot.board[row][4];
  if (!king || king.c !== color || king.t !== "k") return false;
  if (isInCheck(snapshot.board, color)) return false;

  if (side === "k") {
    const rook = snapshot.board[row][7];
    if (!rook || rook.c !== color || rook.t !== "r") return false;
    if (snapshot.board[row][5] || snapshot.board[row][6]) return false;
    if (isSquareAttacked(snapshot.board, row, 5, opposite(color))) return false;
    if (isSquareAttacked(snapshot.board, row, 6, opposite(color))) return false;
    return true;
  }
  const rook = snapshot.board[row][0];
  if (!rook || rook.c !== color || rook.t !== "r") return false;
  if (snapshot.board[row][1] || snapshot.board[row][2] || snapshot.board[row][3]) return false;
  if (isSquareAttacked(snapshot.board, row, 3, opposite(color))) return false;
  if (isSquareAttacked(snapshot.board, row, 2, opposite(color))) return false;
  return true;
}

function pseudoMoves(snapshot: Snapshot, r: number, c: number): Move[] {
  const p = snapshot.board[r][c];
  if (!p) return [];
  const out: Move[] = [];
  const push = (rr: number, cc: number) => {
    if (!inb(rr, cc)) return;
    const t = snapshot.board[rr][cc];
    if (!t || t.c !== p.c) out.push({ from: { r, c }, to: { r: rr, c: cc } });
  };

  if (p.t === "p") {
    const dir = p.c === "w" ? -1 : 1;
    const start = p.c === "w" ? 6 : 1;
    const promoRow = p.c === "w" ? 0 : 7;
    const one = r + dir;
    if (inb(one, c) && !snapshot.board[one][c]) {
      if (one === promoRow) {
        for (const promotion of ["q", "r", "b", "n"] as const) out.push({ from: { r, c }, to: { r: one, c }, promotion });
      } else {
        out.push({ from: { r, c }, to: { r: one, c } });
      }
      const two = r + dir * 2;
      if (r === start && inb(two, c) && !snapshot.board[two][c]) out.push({ from: { r, c }, to: { r: two, c } });
    }
    for (const dc of [-1, 1]) {
      const rr = r + dir, cc = c + dc;
      if (!inb(rr, cc)) continue;
      const target = snapshot.board[rr][cc];
      if (target && target.c !== p.c) {
        if (rr === promoRow) for (const promotion of ["q", "r", "b", "n"] as const) out.push({ from: { r, c }, to: { r: rr, c: cc }, promotion });
        else out.push({ from: { r, c }, to: { r: rr, c: cc } });
      }
      if (snapshot.enPassant === sqName(rr, cc)) out.push({ from: { r, c }, to: { r: rr, c: cc }, enPassant: true });
    }
    return out;
  }

  if (p.t === "n") {
    for (const [dr, dc] of KNIGHT) push(r + dr, c + dc);
    return out;
  }

  if (p.t === "k") {
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) if (dr || dc) push(r + dr, c + dc);
    if (canCastle(snapshot, p.c, "k")) out.push({ from: { r, c }, to: { r, c: 6 }, castle: "k" });
    if (canCastle(snapshot, p.c, "q")) out.push({ from: { r, c }, to: { r, c: 2 }, castle: "q" });
    return out;
  }

  const dirs = p.t === "b" ? BISHOP_DIRS : p.t === "r" ? ROOK_DIRS : QUEEN_DIRS;
  for (const [dr, dc] of dirs) {
    let rr = r + dr, cc = c + dc;
    while (inb(rr, cc)) {
      const target = snapshot.board[rr][cc];
      if (!target) out.push({ from: { r, c }, to: { r: rr, c: cc } });
      else { if (target.c !== p.c) out.push({ from: { r, c }, to: { r: rr, c: cc } }); break; }
      rr += dr; cc += dc;
    }
  }
  return out;
}

function applyMoveRaw(snapshot: Snapshot, mv: Move) {
  const board = cloneBoard(snapshot.board);
  const moving = board[mv.from.r][mv.from.c];
  if (!moving) return null;
  let captured: Piece | null = null;
  board[mv.from.r][mv.from.c] = null;

  if (mv.enPassant) {
    const capRow = mv.to.r + (moving.c === "w" ? 1 : -1);
    captured = board[capRow][mv.to.c];
    board[capRow][mv.to.c] = null;
  } else {
    captured = board[mv.to.r][mv.to.c];
  }

  let placed: Piece = moving;
  if (moving.t === "p" && (mv.to.r === 0 || mv.to.r === 7)) {
    placed = { c: moving.c, t: mv.promotion ?? "q" };
  }
  board[mv.to.r][mv.to.c] = placed;

  if (mv.castle) {
    const row = moving.c === "w" ? 7 : 0;
    if (mv.castle === "k") {
      const rook = board[row][7];
      board[row][7] = null;
      board[row][5] = rook;
    } else {
      const rook = board[row][0];
      board[row][0] = null;
      board[row][3] = rook;
    }
  }

  const castling: CastlingRights = { ...snapshot.castling };
  if (moving.t === "k") {
    if (moving.c === "w") { castling.wk = false; castling.wq = false; }
    else { castling.bk = false; castling.bq = false; }
  }
  if (moving.t === "r") {
    if (mv.from.r === 7 && mv.from.c === 0) castling.wq = false;
    if (mv.from.r === 7 && mv.from.c === 7) castling.wk = false;
    if (mv.from.r === 0 && mv.from.c === 0) castling.bq = false;
    if (mv.from.r === 0 && mv.from.c === 7) castling.bk = false;
  }
  if (captured?.t === "r") {
    if (mv.to.r === 7 && mv.to.c === 0) castling.wq = false;
    if (mv.to.r === 7 && mv.to.c === 7) castling.wk = false;
    if (mv.to.r === 0 && mv.to.c === 0) castling.bq = false;
    if (mv.to.r === 0 && mv.to.c === 7) castling.bk = false;
  }

  let enPassant: string | null = null;
  if (moving.t === "p" && Math.abs(mv.to.r - mv.from.r) === 2) {
    enPassant = sqName((mv.from.r + mv.to.r) / 2, mv.from.c);
  }

  const isPawnMove = moving.t === "p";
  const isCapture = !!captured;
  const halfmoveClock = isPawnMove || isCapture ? 0 : snapshot.halfmoveClock + 1;
  const fullmoveNumber = snapshot.fullmoveNumber + (snapshot.turn === "b" ? 1 : 0);
  const nextTurn = opposite(snapshot.turn);

  return { board, castling, enPassant, captured, moving, placed, halfmoveClock, fullmoveNumber, nextTurn };
}

function sameMove(a: Move, b: Move) {
  return a.from.r === b.from.r && a.from.c === b.from.c && a.to.r === b.to.r && a.to.c === b.to.c &&
    (a.promotion ?? null) === (b.promotion ?? null) && (a.castle ?? null) === (b.castle ?? null) && !!a.enPassant === !!b.enPassant;
}

export function legalMovesForSquare(snapshot: Snapshot, r: number, c: number): Move[] {
  const p = snapshot.board[r][c];
  if (!p) return [];
  return pseudoMoves(snapshot, r, c).filter((mv) => {
    const next = applyMoveRaw(snapshot, mv);
    return !!next && !isInCheck(next.board, p.c);
  });
}

export function hasAnyLegalMove(snapshot: Snapshot, color: Color): boolean {
  if (snapshot.turn !== color) {
    const temp = { ...snapshot, turn: color };
    for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) if (temp.board[r][c]?.c === color && legalMovesForSquare(temp, r, c).length) return true;
    return false;
  }
  for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) if (snapshot.board[r][c]?.c === color && legalMovesForSquare(snapshot, r, c).length) return true;
  return false;
}

function insufficientMaterial(board: Board): boolean {
  const pieces: Array<{ c: Color; t: PieceType; r: number; c2: number }> = [];
  for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) {
    const p = board[r][c];
    if (p) pieces.push({ c: p.c, t: p.t, r, c2: c });
  }
  const nonKings = pieces.filter((p) => p.t !== "k");
  if (nonKings.length === 0) return true;
  if (nonKings.length === 1) return nonKings[0].t === "b" || nonKings[0].t === "n";
  if (nonKings.length === 2 && nonKings.every((p) => p.t === "b")) {
    const wb = nonKings.filter((p) => p.c === "w");
    const bb = nonKings.filter((p) => p.c === "b");
    if (wb.length === 1 && bb.length === 1) {
      const c1 = (wb[0].r + wb[0].c2) % 2;
      const c2 = (bb[0].r + bb[0].c2) % 2;
      return c1 === c2;
    }
  }
  return false;
}

function resultStatus(next: Snapshot): Snapshot {
  if (next.status !== "playing") return next;
  const hasMoves = hasAnyLegalMove(next, next.turn);
  const check = isInCheck(next.board, next.turn);
  if (!hasMoves) {
    if (check) return { ...next, status: "checkmate", winner: opposite(next.turn), resultReason: "checkmate" };
    return { ...next, status: "stalemate", winner: null, resultReason: "stalemate" };
  }
  const currentKey = positionKey(next.board, next.turn, next.castling, next.enPassant);
  const repetitions = next.positionKeys.filter((k) => k === currentKey).length;
  if (repetitions >= 3) return { ...next, status: "draw", winner: null, resultReason: "threefold repetition" };
  if (next.halfmoveClock >= 100) return { ...next, status: "draw", winner: null, resultReason: "fifty-move rule" };
  if (insufficientMaterial(next.board)) return { ...next, status: "draw", winner: null, resultReason: "insufficient material" };
  return next;
}

export function makeMove(snapshot: Snapshot, from: Coord, to: Coord, promotion?: PieceType): Snapshot | null {
  if (snapshot.status !== "playing") return null;
  const moving = snapshot.board[from.r][from.c];
  if (!moving || moving.c !== snapshot.turn) return null;
  const legal = legalMovesForSquare(snapshot, from.r, from.c);
  const desired: Move = { from, to, ...(promotion ? { promotion } : {}) };
  let chosen = legal.find((mv) => sameMove(mv, desired));
  if (!chosen) {
    const candidates = legal.filter((mv) => mv.to.r === to.r && mv.to.c === to.c);
    chosen = promotion ? candidates.find((mv) => mv.promotion === promotion) : candidates.length === 1 ? candidates[0] : candidates.find((mv) => !mv.promotion);
  }
  if (!chosen) return null;

  const raw = applyMoveRaw(snapshot, chosen);
  if (!raw) return null;
  if (isInCheck(raw.board, moving.c)) return null;

  const moveRec: MoveRecord = {
    from: sqName(from.r, from.c),
    to: sqName(to.r, to.c),
    turn: moving.c,
    piece: code(moving) ?? "",
    captured: code(raw.captured) ?? undefined,
    promotion: chosen.promotion,
    castle: chosen.castle,
    enPassant: chosen.enPassant || undefined,
  };
  const nextKey = positionKey(raw.board, raw.nextTurn, raw.castling, raw.enPassant);
  const next: Snapshot = {
    board: raw.board,
    turn: raw.nextTurn,
    status: "playing",
    winner: null,
    resultReason: null,
    history: [...snapshot.history, moveRec],
    last: { from: moveRec.from, to: moveRec.to },
    castling: raw.castling,
    enPassant: raw.enPassant,
    halfmoveClock: raw.halfmoveClock,
    fullmoveNumber: raw.fullmoveNumber,
    positionKeys: [...snapshot.positionKeys, nextKey],
  };
  return resultStatus(next);
}

export function legalTargetSquares(snapshot: Snapshot, r: number, c: number): string[] {
  return [...new Set(legalMovesForSquare(snapshot, r, c).map((m) => sqName(m.to.r, m.to.c)))];
}

export function needsPromotionChoice(snapshot: Snapshot, from: Coord, to: Coord): boolean {
  const p = snapshot.board[from.r][from.c];
  if (!p || p.t !== "p") return false;
  if (p.c === "w" && to.r !== 0) return false;
  if (p.c === "b" && to.r !== 7) return false;
  return legalMovesForSquare(snapshot, from.r, from.c).some((m) => m.to.r === to.r && m.to.c === to.c && !!m.promotion);
}

export function choosePromotionDefault(input: string | null): PieceType | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (v === "q" || v === "queen") return "q";
  if (v === "r" || v === "rook") return "r";
  if (v === "b" || v === "bishop") return "b";
  if (v === "n" || v === "knight") return "n";
  return null;
}

export function snapshotState(snapshot: Snapshot) {
  return {
    castling: snapshot.castling,
    en_passant: snapshot.enPassant,
    halfmove_clock: snapshot.halfmoveClock,
    fullmove_number: snapshot.fullmoveNumber,
    position_keys: snapshot.positionKeys,
    result_reason: snapshot.resultReason,
  };
}

export function snapshotFromRemoteParts(boardRaw: unknown, turn: unknown, status: unknown, winner: unknown, history: unknown, lastMove: unknown, stateRaw: unknown): Snapshot {
  const base = createInitialSnapshot();
  const board = decodeBoard(boardRaw);
  const hist = Array.isArray(history) ? history.filter((x): x is MoveRecord => {
    if (!x || typeof x !== "object") return false;
    const r = x as Record<string, unknown>;
    return typeof r.from === "string" && typeof r.to === "string" && (r.turn === "w" || r.turn === "b") && typeof r.piece === "string";
  }) : [];
  const last = (() => {
    if (!lastMove || typeof lastMove !== "object") return null;
    const r = lastMove as Record<string, unknown>;
    return typeof r.from === "string" && typeof r.to === "string" ? { from: r.from, to: r.to } : null;
  })();
  let castling = base.castling;
  let enPassant: string | null = null;
  let halfmoveClock = 0;
  let fullmoveNumber = 1;
  let positionKeys: string[] = [];
  let resultReason: string | null = null;
  if (stateRaw && typeof stateRaw === "object") {
    const s = stateRaw as Record<string, unknown>;
    const c = s.castling;
    if (c && typeof c === "object") {
      const rc = c as Record<string, unknown>;
      castling = {
        wk: !!rc.wk, wq: !!rc.wq, bk: !!rc.bk, bq: !!rc.bq,
      };
    }
    if (typeof s.en_passant === "string" && parseSquare(s.en_passant)) enPassant = s.en_passant;
    if (typeof s.halfmove_clock === "number" && Number.isFinite(s.halfmove_clock)) halfmoveClock = Math.max(0, Math.trunc(s.halfmove_clock));
    if (typeof s.fullmove_number === "number" && Number.isFinite(s.fullmove_number)) fullmoveNumber = Math.max(1, Math.trunc(s.fullmove_number));
    if (Array.isArray(s.position_keys)) positionKeys = s.position_keys.filter((v): v is string => typeof v === "string");
    if (typeof s.result_reason === "string") resultReason = s.result_reason;
  }
  const t = turn === "b" ? "b" : "w";
  const st: GameStatus = status === "checkmate" || status === "stalemate" || status === "draw" ? status : "playing";
  const win = winner === "w" || winner === "b" ? winner : null;
  if (positionKeys.length === 0) positionKeys = [positionKey(board, t, castling, enPassant)];
  return { board, turn: t, status: st, winner: win, resultReason, history: hist, last, castling, enPassant, halfmoveClock, fullmoveNumber, positionKeys };
}

export function statusText(snapshot: Snapshot): string {
  if (snapshot.status === "playing") {
    return `${snapshot.turn === "w" ? "White" : "Black"} to move${isInCheck(snapshot.board, snapshot.turn) ? " (check)" : ""}`;
  }
  if (snapshot.status === "checkmate") return `Checkmate - ${snapshot.winner === "w" ? "White" : "Black"} wins`;
  if (snapshot.status === "stalemate") return "Draw - stalemate";
  return `Draw${snapshot.resultReason ? ` - ${snapshot.resultReason}` : ""}`;
}

