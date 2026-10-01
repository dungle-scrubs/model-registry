import { describe, expect, test } from "vitest";
import { buildRouteLabel } from "../src/label.js";

describe("buildRouteLabel", () => {
  test("provider absent gives model key at harness", () => {
    expect(buildRouteLabel("model-a", { harness: "harness-x" })).toBe("model-a@harness-x");
  });

  test("provider present gives the provider suffix", () => {
    expect(buildRouteLabel("model-a", { harness: "harness-y", provider: "provider-1" })).toBe(
      "model-a@harness-y/provider-1",
    );
  });

  test("the provider suffix follows presence, not truthiness", () => {
    expect(buildRouteLabel("model-a", { harness: "harness-x", provider: "" })).toBe(
      "model-a@harness-x/",
    );
    expect(buildRouteLabel("model-a", { harness: "harness-x", provider: "0" })).toBe(
      "model-a@harness-x/0",
    );
  });

  test("the label uses the model key, not the modelId", () => {
    const label = buildRouteLabel("key-a", { harness: "harness-x", provider: "provider-1" });
    expect(label.startsWith("key-a@")).toBe(true);
    expect(label).toBe("key-a@harness-x/provider-1");
  });

  test("components are not escaped, normalized or trimmed", () => {
    expect(buildRouteLabel(" key ", { harness: " h " })).toBe(" key @ h ");
    expect(buildRouteLabel("model-a", { harness: "harness/x", provider: "p/q" })).toBe(
      "model-a@harness/x/p/q",
    );
    expect(buildRouteLabel("model-a", { harness: "harnéß" })).toBe("model-a@harnéß");
  });

  test("effort is not part of the label", () => {
    expect(buildRouteLabel("model-a", { harness: "harness-x" })).not.toContain("low");
    expect(buildRouteLabel("model-a", { harness: "harness-x" })).not.toContain("max");
  });

  test("different component splits can collide", () => {
    const fromSplitModel = buildRouteLabel("a@b", { harness: "c" });
    const fromSplitHarness = buildRouteLabel("a", { harness: "b@c" });
    expect(fromSplitModel).toBe("a@b@c");
    expect(fromSplitHarness).toBe("a@b@c");
  });
});
