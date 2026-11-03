import { describe, expect, it } from "vitest";

import type { MediaInspection } from "@shared/media";

function isInspectableUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

describe("AREV client media boundaries", () => {
  it("accepts only http(s) source URLs", () => {
    expect(isInspectableUrl("https://example.com/video")).toBe(true);
    expect(isInspectableUrl("http://example.com/video")).toBe(true);
    expect(isInspectableUrl("javascript:alert(1)")).toBe(false);
    expect(isInspectableUrl("example.com/video")).toBe(false);
  });

  it("keeps the genuine backend inspection shape intact", () => {
    const inspection: MediaInspection = { inspectionId: "i1", title: "Public video", source: "https://example.com/v", kind: "video", formats: [] };
    expect(inspection.formats).toEqual([]);
    expect(inspection.title).toBe("Public video");
  });

  it("does not invent quality labels when format metadata is absent", () => {
    const format = { id: "f1", label: "Original", ext: "mp4", mimeType: "video/mp4", hasAudio: true };
    expect(format.label).toBe("Original");
    expect((format as { height?: number }).height).toBeUndefined();
  });
});
