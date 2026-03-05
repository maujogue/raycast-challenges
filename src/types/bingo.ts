export type BingoCellStatus = "todo" | "validated";

export interface BingoCell {
  id: string;
  text: string;
  prompt?: string;
  status: BingoCellStatus;
  /** Participant who helped fill this answer (id and display name for UI). */
  helpedByParticipantId?: string | null;
  helpedByDisplayName?: string | null;
}

export interface BingoBoard {
  id: string;
  title: string;
  theme?: string;
  ownerId: string;
  cells: BingoCell[];
  createdAt: string;
  updatedAt: string;
}

export interface BingoParticipant {
  id: string;
  boardId: string;
  displayName: string;
  joinedAt: string;
}

export interface LeaderboardEntry {
  participantId: string;
  displayName: string;
  validatedCount: number;
  score: number;
}

export interface ScoreBreakdown {
  validatedCells: number;
  totalCells: number;
  completionRate: number;
  score: number;
}

export function computeScore(cells: BingoCell[]): ScoreBreakdown {
  const totalCells = cells.length;
  const validatedCells = cells.filter((cell) => cell.status === "validated").length;
  const completionRate = totalCells === 0 ? 0 : validatedCells / totalCells;
  const score = validatedCells;

  return {
    validatedCells,
    totalCells,
    completionRate,
    score,
  };
}
