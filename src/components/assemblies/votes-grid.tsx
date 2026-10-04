"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ResolutionResultBadge } from "@/components/assemblies/badges";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  isAdopted,
  type Majority,
  tallyVotes,
  type VoteChoice,
  voteChoices,
} from "@/lib/assemblies";
import { cn } from "@/lib/utils";
import { saveVotesAction } from "@/server/assemblies/actions";

const cycle: (VoteChoice | null)[] = [null, ...voteChoices];

const choiceClasses: Record<VoteChoice, string> = {
  for: "bg-emerald-100 text-emerald-900",
  against: "bg-red-100 text-red-900",
  abstain: "bg-zinc-200 text-zinc-700",
};

type Voter = { unitId: string; code: string; coOwnerName: string | null; share: number };

/**
 * Votes of the present and represented units on each resolution: a cell is clicked to cycle
 * through for, against, abstain and no vote; tallies and results follow live (by tantièmes).
 * Saved as a whole; read-only once the assembly is closed.
 */
export function VotesGrid({
  assemblyId,
  resolutions,
  voters,
  votes,
  totalShares,
  editable,
}: {
  assemblyId: string;
  resolutions: { id: string; position: number; title: string; majority: Majority }[];
  voters: Voter[];
  votes: { resolutionId: string; unitId: string; choice: VoteChoice }[];
  totalShares: number;
  editable: boolean;
}) {
  const t = useTranslations("assemblies.votes");
  const save = useAction(saveVotesAction);
  const [choices, setChoices] = useState<Record<string, VoteChoice>>(() =>
    Object.fromEntries(votes.map((v) => [`${v.resolutionId}:${v.unitId}`, v.choice])),
  );
  const toggle = (key: string) =>
    setChoices((prev) => {
      const next = cycle[(cycle.indexOf(prev[key] ?? null) + 1) % cycle.length] ?? null;
      const copy = { ...prev };
      if (next === null) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  const allFor = (resolutionId: string) =>
    setChoices((prev) => ({
      ...prev,
      ...Object.fromEntries(voters.map((v) => [`${resolutionId}:${v.unitId}`, "for" as const])),
    }));
  const tallyOf = (resolutionId: string) =>
    tallyVotes(
      voters.flatMap((v) => {
        const choice = choices[`${resolutionId}:${v.unitId}`];
        return choice ? [{ choice, share: v.share }] : [];
      }),
    );

  if (voters.length === 0) return <p className="text-sm text-muted-foreground">{t("noVoters")}</p>;
  return (
    <div className="space-y-3">
      {editable ? <p className="text-sm text-muted-foreground">{t("legend")}</p> : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm" data-testid="votes-grid">
          <thead>
            <tr className="border-b">
              <th className="sticky start-0 bg-background p-2 text-start font-medium">
                {t("unit")}
              </th>
              <th className="p-2 text-end font-medium">{t("share")}</th>
              {resolutions.map((r) => (
                <th key={r.id} className="min-w-28 p-2 text-center align-top font-medium">
                  <div title={r.title}>{t("resolution", { position: r.position })}</div>
                  {editable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs font-normal"
                      aria-label={t("allForLabel", { position: r.position })}
                      onClick={() => allFor(r.id)}
                    >
                      {t("allFor")}
                    </Button>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {voters.map((v) => (
              <tr key={v.unitId} className="border-b" data-unit={v.code}>
                <td className="sticky start-0 bg-background p-2 whitespace-nowrap">
                  <span className="font-medium" dir="ltr">
                    {v.code}
                  </span>
                  {v.coOwnerName ? (
                    <span className="text-muted-foreground"> · {v.coOwnerName}</span>
                  ) : null}
                </td>
                <td className="p-2 text-end tabular-nums">{v.share}</td>
                {resolutions.map((r) => {
                  const key = `${r.id}:${v.unitId}`;
                  const choice = choices[key];
                  return (
                    <td key={r.id} className="p-1 text-center">
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() => toggle(key)}
                        aria-label={t("cellLabel", {
                          code: v.code,
                          position: r.position,
                          choice: choice ? t(`choice.${choice}`) : t("notVoted"),
                        })}
                        className={cn(
                          "h-7 w-full min-w-20 rounded text-xs disabled:cursor-default",
                          choice ? choiceClasses[choice] : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {choice ? t(`choice.${choice}`) : "·"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky start-0 bg-background p-2 font-medium" colSpan={2}>
                {t("results", { total: totalShares })}
              </td>
              {resolutions.map((r) => {
                const tally = tallyOf(r.id);
                const adopted = isAdopted(r.majority, tally, totalShares);
                return (
                  <td
                    key={r.id}
                    className="p-2 text-center align-top text-xs"
                    data-testid={`result-${r.position}`}
                  >
                    <div className="tabular-nums">
                      {t("tally", { yes: tally.for, no: tally.against, abstain: tally.abstain })}
                    </div>
                    <div className="mt-1">
                      <ResolutionResultBadge adopted={adopted} />
                    </div>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      {editable ? (
        <Button
          disabled={save.pending}
          onClick={() =>
            void save.run(
              {
                assemblyId,
                votes: resolutions.flatMap((r) =>
                  voters.flatMap((v) => {
                    const choice = choices[`${r.id}:${v.unitId}`];
                    return choice ? [{ resolutionId: r.id, unitId: v.unitId, choice }] : [];
                  }),
                ),
              },
              { onSuccess: () => toast.success(t("saved")) },
            )
          }
        >
          {t("save")}
        </Button>
      ) : null}
    </div>
  );
}
