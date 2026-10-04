/**
 * General assemblies of a residence (module 6): vocabulary and vote results. Votes are weighted
 * by tantièmes; each resolution has its own majority (CLAUDE.md §12). Isomorphic.
 */

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
