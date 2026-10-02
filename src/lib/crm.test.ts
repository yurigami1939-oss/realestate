import { describe, expect, it } from "vitest";

import { advanceStage, openLeadStages } from "./crm";

describe("pipeline stages", () => {
  it("only moves forward, and never out of a closed stage", () => {
    expect(advanceStage("new", "visit_scheduled")).toBe("visit_scheduled");
    expect(advanceStage("negotiation", "visited")).toBe("negotiation");
    expect(advanceStage("lost", "visited")).toBe("lost");
    expect(advanceStage("won", "negotiation")).toBe("won");
  });

  it("lists the open stages in pipeline order", () => {
    expect(openLeadStages).toEqual([
      "new",
      "contacted",
      "visit_scheduled",
      "visited",
      "negotiation",
    ]);
  });
});
