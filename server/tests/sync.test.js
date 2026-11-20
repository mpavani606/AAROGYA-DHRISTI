import { describe, expect, it } from "@jest/globals";
import { SyncItem } from "../dist/models/SyncItem.js";
import { SyncBatch } from "../dist/models/SyncBatch.js";
import { missingChunkIndexes, requiresConflictReview } from "../dist/services/syncPolicy.js";

describe("Phase 9 offline sync safeguards", () => {
  it("uses a unique user/device/client UUID key so repeating an item cannot create a second document", () => {
    const uniqueKeys = SyncItem.schema.indexes().filter(([, options]) => options.unique).map(([keys]) => Object.keys(keys).sort());
    expect(uniqueKeys).toContainEqual(["clientUuid", "deviceId", "user"]);
    expect(SyncBatch.schema.indexes().some(([, options]) => options.unique)).toBe(true);
  });
  it("returns only missing chunk indexes after a network interruption", () => {
    expect(missingChunkIndexes(5, [0, 1, 3])).toEqual([2, 4]);
    expect(missingChunkIndexes(3, [0, 1, 2])).toEqual([]);
  });
  it("routes signed review and note conflicts to manual review instead of overwriting", () => {
    expect(requiresConflictReview("signed_review")).toBe(true);
    expect(requiresConflictReview("signed_note")).toBe(true);
    expect(requiresConflictReview("update_patient")).toBe(false);
  });
});
