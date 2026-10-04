/**
 * General assemblies of a residence (module 6): vocabulary and vote results. Votes are weighted
 * by tantièmes; each resolution has its own majority (CLAUDE.md §12). Isomorphic.
 */
import { formatShare } from "./payment-plans";

export const assemblyKinds = ["ordinary", "extraordinary"] as const;
export type AssemblyKind = (typeof assemblyKinds)[number];

/** draft (agenda being prepared) → convened (convocation issued) → closed (votes final, PV). */
export const assemblyStatuses = ["draft", "convened", "closed"] as const;
export type AssemblyStatus = (typeof assemblyStatuses)[number];

/**
 * - `simple`: more tantièmes for than against among the votes cast (abstentions do not count);
 * - `absolute`: more than half of all the residence's tantièmes;
 * - `two_thirds`: at least two thirds of all the residence's tantièmes;
 * - `unanimity`: every tantième of the residence votes for.
 */
export const majorities = ["simple", "absolute", "two_thirds", "unanimity"] as const;
export type Majority = (typeof majorities)[number];

export const attendanceKinds = ["present", "represented", "absent"] as const;
export type AttendanceKind = (typeof attendanceKinds)[number];

export const voteChoices = ["for", "against", "abstain"] as const;
export type VoteChoice = (typeof voteChoices)[number];

export type VoteTally = { for: number; against: number; abstain: number };

/** Only present or represented units vote; absent units still count in the residence's total. */
export const votingKinds: readonly AttendanceKind[] = ["present", "represented"];

/** Part of the residence's tantièmes as a percentage: "70 %", "33,33 %". */
export function formatSharesPercent(part: number, total: number): string {
  return formatShare(total > 0 ? Math.round((part * 10_000) / total) : 0);
}

/** Tantièmes for / against / abstaining among the votes cast on a resolution. */
export function tallyVotes(votes: readonly { choice: VoteChoice; share: number }[]): VoteTally {
  const tally: VoteTally = { for: 0, against: 0, abstain: 0 };
  for (const vote of votes) tally[vote.choice] += vote.share;
  return tally;
}

/** Whether a resolution passes, from its tallies (tantièmes) and the residence's total. */
export function isAdopted(majority: Majority, tally: VoteTally, totalShares: number): boolean {
  switch (majority) {
    case "simple":
      return tally.for > tally.against;
    case "absolute":
      return tally.for * 2 > totalShares;
    case "two_thirds":
      return tally.for * 3 >= totalShares * 2;
    case "unanimity":
      return totalShares > 0 && tally.for === totalShares;
  }
}
