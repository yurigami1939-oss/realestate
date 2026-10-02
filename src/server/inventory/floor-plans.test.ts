import { GetObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { file, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { MAX_UPLOAD_BYTES } from "@/lib/files";
import type { TenantCtx } from "@/server/auth/session";
import { bucket, s3 } from "@/server/files/s3";
import { getFileDownloadUrl } from "@/server/files/service";

import { createTenantCtx } from "../../../tests/factories";

import { removeUnitFloorPlan, setUnitFloorPlan } from "./floor-plans";
import { getUnit } from "./queries";
import { createBuildingSchema, createProjectSchema, createUnitSchema } from "./schemas";
import { createBuilding, createProject, createUnit } from "./service";

const pdf = (body = "plan") => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF`);
const png = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3]);

async function createUnitFor(ctx: TenantCtx) {
  const { id: projectId } = await createProject(
    ctx,
    createProjectSchema.parse({ code: "PLAN", name: "Résidence du Parc", status: "planning" }),
  );
  const { id: buildingId } = await createBuilding(
    ctx,
    createBuildingSchema.parse({
      projectId,
      code: "A",
      name: "Bloc A",
      lowestFloor: "0",
      topFloor: "4",
    }),
  );
  const { id } = await createUnit(
    ctx,
    createUnitSchema.parse({
      buildingId,
      code: "A-01-01",
      floor: "1",
      type: "apartment",
      isDuplex: false,
      orientations: [],
    }),
  );
  return id;
}

const fileRow = (ctx: TenantCtx, id: string) =>
  withTenant(ctx, async (tx) => (await tx.select().from(file).where(eq(file.id, id)))[0]);

const unitPlanId = (ctx: TenantCtx, id: string) =>
  withTenant(
    ctx,
    async (tx) =>
      (await tx.select({ id: unit.floorPlanFileId }).from(unit).where(eq(unit.id, id)))[0]?.id,
  );

async function readObject(key: string) {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return new Uint8Array(await (object.Body?.transformToByteArray() ?? Promise.resolve([])));
}

describe("unit floor plans", () => {
  it("stores the file under the tenant's key and links it to the unit", async () => {
    const ctx = await createTenantCtx(["sales_manager"]);
    const unitId = await createUnitFor(ctx);
    const bytes = pdf();

    const { fileId } = await setUnitFloorPlan(ctx, {
      unitId,
      upload: { fileName: "C:\\Plans\\Plan A-01-01.pdf", bytes },
    });

    expect(await unitPlanId(ctx, unitId)).toBe(fileId);
    const row = await fileRow(ctx, fileId);
    expect(row).toMatchObject({
      storageKey: `org/${ctx.orgId}/unit/${unitId}/${fileId}.pdf`,
      fileName: "Plan A-01-01.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.byteLength,
      entityType: "unit",
      entityId: unitId,
      uploadedBy: ctx.userId,
      deletedAt: null,
    });
    expect(await readObject(row?.storageKey ?? "")).toEqual(bytes);

    const detail = await getUnit(ctx, unitId);
    expect(detail?.floorPlan).toEqual({
      id: fileId,
      fileName: "Plan A-01-01.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.byteLength,
    });
  });

  it("replaces the previous plan, which can no longer be downloaded", async () => {
    const ctx = await createTenantCtx();
    const unitId = await createUnitFor(ctx);
    const first = await setUnitFloorPlan(ctx, {
      unitId,
      upload: { fileName: "v1.pdf", bytes: pdf() },
    });
    const second = await setUnitFloorPlan(ctx, {
      unitId,
      upload: { fileName: "v2.png", bytes: png() },
    });

    expect(await unitPlanId(ctx, unitId)).toBe(second.fileId);
    expect((await fileRow(ctx, first.fileId))?.deletedAt).toBeInstanceOf(Date);
    expect((await fileRow(ctx, second.fileId))?.storageKey).toMatch(/\.png$/);
    await expect(getFileDownloadUrl(ctx, first.fileId, "inline")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it.each([
    ["files.errors.type", "notes.txt", new TextEncoder().encode("not a plan")],
    ["files.errors.type", "plan.pdf", new TextEncoder().encode("<svg onload=alert(1)>")],
    ["files.errors.empty", "plan.pdf", new Uint8Array()],
    [
      "files.errors.tooLarge",
      "plan.pdf",
      (() => {
        const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
        big.set(pdf());
        return big;
      })(),
    ],
  ])("refuses %s (%s) without writing anything", async (messageKey, fileName, bytes) => {
    const ctx = await createTenantCtx();
    const unitId = await createUnitFor(ctx);
    await expect(
      setUnitFloorPlan(ctx, { unitId, upload: { fileName, bytes } }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey });
    expect(await unitPlanId(ctx, unitId)).toBeNull();
    const files = await withTenant(ctx, (tx) => tx.select().from(file));
    expect(files).toHaveLength(0);
  });

  it("lets readers download but only editors upload or remove", async () => {
    const owner = await createTenantCtx();
    const unitId = await createUnitFor(owner);
    const { fileId } = await setUnitFloorPlan(owner, {
      unitId,
      upload: { fileName: "plan.pdf", bytes: pdf() },
    });
    const agent: TenantCtx = { ...owner, roles: ["sales_agent"] };
    const resident: TenantCtx = { ...owner, roles: ["resident"] };

    await expect(
      setUnitFloorPlan(agent, { unitId, upload: { fileName: "x.pdf", bytes: pdf() } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeUnitFloorPlan(agent, { unitId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getFileDownloadUrl(agent, fileId, "inline")).resolves.toMatch(/^http/);
    await expect(getFileDownloadUrl(resident, fileId, "inline")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("never reaches another tenant's unit or file", async () => {
    const a = await createTenantCtx();
    const b = await createTenantCtx();
    const unitId = await createUnitFor(a);
    const { fileId } = await setUnitFloorPlan(a, {
      unitId,
      upload: { fileName: "plan.pdf", bytes: pdf() },
    });

    await expect(
      setUnitFloorPlan(b, { unitId, upload: { fileName: "x.pdf", bytes: pdf() } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeUnitFloorPlan(b, { unitId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getFileDownloadUrl(b, fileId, "inline")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await unitPlanId(a, unitId)).toBe(fileId);
  });

  it("removes the plan (idempotent)", async () => {
    const ctx = await createTenantCtx();
    const unitId = await createUnitFor(ctx);
    const { fileId } = await setUnitFloorPlan(ctx, {
      unitId,
      upload: { fileName: "plan.pdf", bytes: pdf() },
    });

    await removeUnitFloorPlan(ctx, { unitId });
    await removeUnitFloorPlan(ctx, { unitId });

    expect(await unitPlanId(ctx, unitId)).toBeNull();
    expect((await fileRow(ctx, fileId))?.deletedAt).toBeInstanceOf(Date);
    expect((await getUnit(ctx, unitId))?.floorPlan).toBeNull();
  });

  it("serves a presigned link with the original name and type", async () => {
    const ctx = await createTenantCtx();
    const unitId = await createUnitFor(ctx);
    const bytes = pdf("contenu");
    const { fileId } = await setUnitFloorPlan(ctx, {
      unitId,
      upload: { fileName: "مخطط A-01-01.pdf", bytes },
    });

    const url = await getFileDownloadUrl(ctx, fileId, "attachment");
    expect(url).toContain("X-Amz-Expires=300");
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="____ A-01-01.pdf"; filename*=UTF-8''%D9%85%D8%AE%D8%B7%D8%B7%20A-01-01.pdf`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
