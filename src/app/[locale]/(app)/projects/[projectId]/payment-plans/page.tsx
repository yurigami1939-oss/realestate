import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toLocale } from "@/i18n/locales";
import { formatShare, type PlanStep } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getProject } from "@/server/inventory/queries";
import { deletePaymentPlanAction } from "@/server/payment-plans/actions";
import { getProjectPaymentSetup, type PaymentPlanWithSteps } from "@/server/payment-plans/queries";

import { MilestonesEditor } from "./_components/milestones-editor";
import { PlanDialog } from "./_components/plan-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("paymentPlans");
  return { title: t("title") };
}

type Milestone = { id: string; name: string };

export default async function PaymentPlansPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/payment-plans">) {
  const { locale, projectId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("inventory:read");
  const project = await getProject(ctx, projectId);
  if (!project) notFound();
  const { milestones, plans } = await getProjectPaymentSetup(ctx, projectId);
  const editable = can(ctx.roles, "project:update");
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("paymentPlans.title")}
        description={t("paymentPlans.description")}
        crumbs={[
          { label: t("inventory.projects.title"), href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
        ]}
        actions={editable ? <PlanDialog projectId={projectId} milestones={milestones} /> : null}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("paymentPlans.milestones")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("paymentPlans.milestonesHint")}</p>
        </CardHeader>
        <CardContent>
          {/* Remounted when the saved list changes: new rows get their ids. */}
          <MilestonesEditor
            key={milestones.map((m) => `${m.id}:${m.validatedOn ?? ""}`).join()}
            projectId={projectId}
            milestones={milestones}
            editable={editable}
          />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("paymentPlans.plans")}</h2>
        {plans.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            {t("paymentPlans.noPlans")}
          </p>
        ) : (
          plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              projectId={projectId}
              milestones={milestones}
              editable={editable}
            />
          ))
        )}
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  projectId,
  milestones,
  editable,
}: {
  plan: PaymentPlanWithSteps;
  projectId: string;
  milestones: Milestone[];
  editable: boolean;
}) {
  const t = useTranslations("paymentPlans");
  const tc = useTranslations("common");
  const due = (step: PlanStep) =>
    step.trigger === "signing"
      ? t("trigger.signing")
      : step.trigger === "months_after_signing"
        ? t("monthsAfter", { months: step.months ?? 0 })
        : (milestones.find((m) => m.id === step.milestoneId)?.name ?? "—");

  return (
    <Card data-testid="payment-plan">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {plan.name}
          {plan.isDefault ? <Badge variant="secondary">{t("default")}</Badge> : null}
        </CardTitle>
        {editable ? (
          <div className="flex gap-2">
            <PlanDialog projectId={projectId} milestones={milestones} plan={plan} />
            <ConfirmAction
              action={deletePaymentPlanAction}
              input={{ planId: plan.id }}
              label={tc("delete")}
              icon={<Trash2 data-icon="inline-start" />}
              title={t("deleteTitle", { name: plan.name })}
              description={t("deleteDescription")}
              confirmLabel={tc("delete")}
              successMessage={t("deleted")}
              variant="ghost"
              destructive
            />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("step.label")}</TableHead>
              <TableHead>{t("step.trigger")}</TableHead>
              <TableHead className="text-end">{t("step.share")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.steps.map((step, index) => (
              <TableRow key={index}>
                <TableCell>{step.label}</TableCell>
                <TableCell>{due(step)}</TableCell>
                <TableCell className="text-end" dir="ltr">
                  {formatShare(step.shareBp)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {plan.notes ? <p className="text-sm text-muted-foreground">{plan.notes}</p> : null}
      </CardContent>
    </Card>
  );
}
