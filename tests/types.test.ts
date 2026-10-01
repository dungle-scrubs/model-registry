import { describe, expectTypeOf, test } from "vitest";
import type {
  IndexedRoute,
  JsonValue,
  LoadedRegistry,
  LoadRegistryOptions,
  Model,
  RegistryDigest,
  RegistryErrorCode,
  RegistryErrorDetails,
  RegistryFacts,
  RegistryFile,
  RegistryProblem,
  Route,
  RouteLabel,
} from "../src/types.js";

const route: Route = {
  harness: "harness-x",
  modelId: "model-id-a",
  provider: "provider-1",
  hosted: true,
  privacyEligible: true,
  cost: 7,
  rateLimitRpm: 12.5,
  responseSeconds: 0.4,
  notes: "placeholder",
};

const model: Model = { family: "family-a", notes: "placeholder", routes: [route] };

describe("public types", () => {
  test("the loader result carries the RFC shape", () => {
    expectTypeOf<LoadRegistryOptions>().toMatchTypeOf<{ path?: string }>();
    expectTypeOf<LoadedRegistry["format"]>().toEqualTypeOf<1>();
    expectTypeOf<LoadedRegistry["digest"]>().toEqualTypeOf<RegistryDigest>();
    expectTypeOf<LoadedRegistry["path"]>().toEqualTypeOf<string>();
    expectTypeOf<LoadedRegistry["registry"]>().toEqualTypeOf<RegistryFacts>();
    expectTypeOf<LoadedRegistry["routes"]>().toEqualTypeOf<Record<RouteLabel, IndexedRoute>>();
    expectTypeOf<LoadedRegistry["sections"]>().toEqualTypeOf<Record<string, JsonValue>>();
    expectTypeOf<RegistryFile>().toMatchTypeOf<{ format: 1; models: Record<string, Model> }>();
  });

  test("an indexed route is the route facts plus the model key", () => {
    const indexed: IndexedRoute = { model: "model-a", ...route };
    expectTypeOf<IndexedRoute>().toEqualTypeOf<Route & { model: string }>();
    expectTypeOf(indexed.model).toEqualTypeOf<string>();
  });

  test("model and route field tables are the supported slice", () => {
    expectTypeOf<Model>().toMatchTypeOf<{
      family: string;
      notes?: string;
      routes: Route[];
    }>();
    expectTypeOf<Route>().toMatchTypeOf<{
      harness: string;
      modelId: string;
      provider?: string;
      hosted: boolean;
      privacyEligible?: boolean;
      rateLimitRpm?: number;
      responseSeconds?: number;
      notes?: string;
    }>();
    expectTypeOf<Required<Route>["cost"]>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10>();
  });

  test("problems and error details carry every required field", () => {
    expectTypeOf<RegistryProblem["code"]>().toEqualTypeOf<RegistryErrorCode>();
    expectTypeOf<RegistryProblem["field"]>().toEqualTypeOf<string>();
    expectTypeOf<RegistryProblem["message"]>().toEqualTypeOf<string>();
    expectTypeOf<RegistryProblem["fix"]>().toEqualTypeOf<string>();
    expectTypeOf<RegistryErrorDetails["problems"]>().toEqualTypeOf<RegistryProblem[]>();
    expectTypeOf<RegistryErrorCode>().toEqualTypeOf<
      | "registry-missing"
      | "registry-unreadable"
      | "format-missing"
      | "format-unsupported"
      | "registry-invalid"
      | "label-duplicate"
      | "reference-unknown"
      | "rating-mismatch"
    >();
  });

  test("JsonValue accepts JSON and rejects null", () => {
    const value: JsonValue = { a: [1, "b", false, { c: [] }] };
    const items: JsonValue[] = [value, 1, "s", true, []];
    expectTypeOf(items).toEqualTypeOf<JsonValue[]>();
  });

  test("a digest is a sha256 template literal", () => {
    const digest: RegistryDigest =
      "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    expectTypeOf(digest).toEqualTypeOf<RegistryDigest>();
  });

  test("positive assignments compile", () => {
    const minimalRoute: Route = { harness: "harness-x", modelId: "model-id-a", hosted: false };
    const file: RegistryFile = {
      format: 1,
      models: { "model-a": model, "model-b": { family: "family-a", routes: [minimalRoute] } },
    };
    expectTypeOf(file).toMatchTypeOf<RegistryFile>();
    const withForeignSection: RegistryFile = { format: 1, models: {}, router: { enabled: true } };
    expectTypeOf(withForeignSection.router).toEqualTypeOf<JsonValue | undefined>();
    expectTypeOf(withForeignSection.models).toEqualTypeOf<Record<string, Model>>();
  });

  test("negative assignments stay type errors", () => {
    // @ts-expect-error hosted must be a boolean
    const hostedString: Route = { harness: "h", modelId: "m", hosted: "yes" };
    // @ts-expect-error hosted is required
    const hostedMissing: Route = { harness: "h", modelId: "m" };
    // @ts-expect-error harness must be a string
    const harnessNumber: Route = { harness: 5, modelId: "m", hosted: true };
    // @ts-expect-error modelId must be a string
    const modelIdNull: Route = { harness: "h", modelId: null, hosted: true };
    // @ts-expect-error provider must be a string
    const providerNull: Route = { harness: "h", modelId: "m", provider: null, hosted: true };
    // @ts-expect-error notes must be a string
    const notesNull: Route = { harness: "h", modelId: "m", hosted: true, notes: null };
    // @ts-expect-error cost is bounded 1-10
    const costZero: Route = { harness: "h", modelId: "m", hosted: true, cost: 0 };
    // @ts-expect-error unknown route field
    const routeExtra: Route = { harness: "h", modelId: "m", hosted: true, surprise: 1 };
    // @ts-expect-error family is required
    const familyMissing: Model = { routes: [] };
    // @ts-expect-error routes is required
    const routesMissing: Model = { family: "family-a" };
    // @ts-expect-error unknown model field
    const modelExtra: Model = { family: "family-a", routes: [], surprise: 1 };
    // @ts-expect-error deferred route capability field
    const routeCapability: Route = { harness: "h", modelId: "m", hosted: true, capabilities: [] };
    // @ts-expect-error deferred route meter field
    const routeMeter: Route = { harness: "h", modelId: "m", hosted: true, meter: "plan-a" };
    // @ts-expect-error deferred model maxEffort field
    const modelEffort: Model = { family: "family-a", routes: [], maxEffort: "high" };
    // @ts-expect-error null is not a JsonValue
    const jsonNull: JsonValue = null;
    // @ts-expect-error optional fields cannot be explicitly undefined
    const explicitUndefined: Route = {
      harness: "h",
      modelId: "m",
      hosted: true,
      provider: undefined,
    };
    // @ts-expect-error format 1 only
    const formatTwo: RegistryFile = { format: 2, models: {} };
    // @ts-expect-error deferred top-level section ratings
    const topLevelRatings: RegistryFile = { format: 1, models: {}, ratings: { coding: "x" } };
    // @ts-expect-error deferred top-level section capabilities
    const topLevelCapabilities: RegistryFile = { format: 1, models: {}, capabilities: 1 };
    // @ts-expect-error deferred top-level section meters
    const topLevelMeters: RegistryFile = { format: 1, models: {}, meters: 1 };
    // @ts-expect-error deferred top-level section calibration
    const topLevelCalibration: RegistryFile = { format: 1, models: {}, calibration: {} };
    expectTypeOf(
      Object.keys({
        hostedString,
        hostedMissing,
        harnessNumber,
        modelIdNull,
        providerNull,
        notesNull,
        costZero,
        routeExtra,
        familyMissing,
        routesMissing,
        modelExtra,
        routeCapability,
        routeMeter,
        modelEffort,
        jsonNull,
        explicitUndefined,
        formatTwo,
        topLevelRatings,
        topLevelCapabilities,
        topLevelMeters,
        topLevelCalibration,
      }).length,
    ).toBeNumber();
  });
});
