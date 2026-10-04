import { describe, expectTypeOf, test } from "vitest";
import type { Profile, ProfileDeclaration, ProfileProvenance } from "../src/index.js";
import type { EffortLevel } from "../src/ladder.js";
import type {
  IndexedRoute,
  JsonValue,
  LoadedRegistry,
  LoadRegistryOptions,
  Meter,
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
  test("profiles expose separate file and normalized public types", () => {
    expectTypeOf<Profile>().toEqualTypeOf<{
      readonly description?: string;
      readonly routes: readonly RouteLabel[];
    }>();
    expectTypeOf<ProfileDeclaration>().toEqualTypeOf<{
      description: string;
      routes: RouteLabel[];
    }>();
    expectTypeOf<ProfileProvenance>().toEqualTypeOf<"implicit" | "declared">();
    expectTypeOf<LoadedRegistry["profiles"]>().toEqualTypeOf<Readonly<Record<string, Profile>>>();
    expectTypeOf<LoadedRegistry["profileProvenance"]>().toEqualTypeOf<
      Readonly<Record<string, ProfileProvenance>>
    >();
    expectTypeOf<RegistryFile["profiles"]>().toEqualTypeOf<
      Record<string, ProfileDeclaration> | undefined
    >();
    expectTypeOf<Extract<keyof RegistryFacts, "profiles">>().toEqualTypeOf<never>();
    const implicit: Profile = { routes: [] };
    const declared: ProfileDeclaration = { description: "Subset.", routes: ["model-a@harness-x"] };
    const file: RegistryFile = { format: 1, models: {}, profiles: { budget: declared } };
    expectTypeOf(implicit).toEqualTypeOf<Profile>();
    expectTypeOf(file).toEqualTypeOf<RegistryFile>();
    // @ts-expect-error a declaration requires a description
    const missingDescription: ProfileDeclaration = { routes: [] };
    // @ts-expect-error route entries must be strings
    const invalidEntry: ProfileDeclaration = { description: "Subset.", routes: [1] };
    // @ts-expect-error gaps is not supported by this slice
    const extraField: ProfileDeclaration = { description: "Subset.", routes: [], gaps: [] };
    expectTypeOf({ missingDescription, invalidEntry, extraField }).toBeObject();
  });
  test("the loader result carries the RFC shape", () => {
    expectTypeOf<LoadRegistryOptions>().toMatchTypeOf<{ path?: string }>();
    expectTypeOf<LoadedRegistry["format"]>().toEqualTypeOf<1>();
    expectTypeOf<LoadedRegistry["digest"]>().toEqualTypeOf<RegistryDigest>();
    expectTypeOf<LoadedRegistry["path"]>().toEqualTypeOf<string>();
    expectTypeOf<LoadedRegistry["registry"]>().toEqualTypeOf<RegistryFacts>();
    expectTypeOf<LoadedRegistry["routes"]>().toEqualTypeOf<
      Readonly<Record<RouteLabel, IndexedRoute>>
    >();
    expectTypeOf<LoadedRegistry["sections"]>().toEqualTypeOf<Readonly<Record<string, JsonValue>>>();
    expectTypeOf<RegistryFile>().toMatchTypeOf<{ format: 1; models: Record<string, Model> }>();
  });

  test("the declared sections are typed registry facts", () => {
    expectTypeOf<Required<RegistryFacts>["meters"]>().toEqualTypeOf<
      Readonly<Record<string, Meter>>
    >();
    expectTypeOf<RegistryFacts["meters"]>().toEqualTypeOf<
      Readonly<Record<string, Meter>> | undefined
    >();
    expectTypeOf<RegistryFacts["ratings"]>().toEqualTypeOf<
      Readonly<Record<string, string>> | undefined
    >();
    expectTypeOf<RegistryFacts["capabilities"]>().toEqualTypeOf<
      Readonly<Record<string, string>> | undefined
    >();
    expectTypeOf<Meter>().toEqualTypeOf<{
      readonly notes?: string;
      readonly spendToZero?: true;
    }>();
    expectTypeOf<RegistryFile>().toMatchTypeOf<{
      ratings?: Record<string, string>;
      capabilities?: Record<string, string>;
      meters?: Record<string, Meter>;
    }>();
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
      ratings?: Readonly<Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10>>;
      maxEffort?: EffortLevel;
      fixedEffort?: EffortLevel;
      routes: readonly Route[];
    }>();
    expectTypeOf<Route>().toMatchTypeOf<{
      harness: string;
      modelId: string;
      provider?: string;
      hosted: boolean;
      privacyEligible?: boolean;
      cost?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
      rateLimitRpm?: number;
      responseSeconds?: number;
      notes?: string;
      capabilities?: readonly string[];
      meter?: string;
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
      | "backup-exists"
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
    expectTypeOf<RegistryDigest>().toEqualTypeOf<`sha256:${string}`>();
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
    // @ts-expect-error spendToZero accepts only the literal true
    const spendFalse: Meter = { spendToZero: false };
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
    // @ts-expect-error a digest requires the sha256: prefix
    const digestWithoutPrefix: RegistryDigest = "00000000000000000000000000000000";
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
        spendFalse,
        jsonNull,
        explicitUndefined,
        formatTwo,
        digestWithoutPrefix,
      }).length,
    ).toBeNumber();
  });
});
