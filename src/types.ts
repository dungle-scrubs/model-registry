import type { EffortLevel } from "./ladder.js";

export type JsonValue =
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { [key: string]: JsonValue };

export type RegistryDigest = `sha256:${string}`;

export type RouteLabel = string;

export type RegistryErrorCode =
  | "registry-missing"
  | "registry-unreadable"
  | "format-missing"
  | "format-unsupported"
  | "registry-invalid"
  | "label-duplicate"
  | "reference-unknown"
  | "rating-mismatch"
  | "backup-exists";

export type RatingValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Meter = {
  readonly notes?: string;
  readonly spendToZero?: true;
};

export type Route = {
  readonly capabilities?: readonly string[];
  readonly cost?: RatingValue;
  readonly harness: string;
  readonly hosted: boolean;
  readonly meter?: string;
  readonly modelId: string;
  readonly notes?: string;
  readonly privacyEligible?: boolean;
  readonly provider?: string;
  readonly rateLimitRpm?: number;
  readonly responseSeconds?: number;
};

export type Model = {
  readonly family: string;
  readonly fixedEffort?: EffortLevel;
  readonly maxEffort?: EffortLevel;
  readonly notes?: string;
  readonly ratings?: Readonly<Record<string, RatingValue>>;
  readonly routes: readonly Route[];
};

/** The reserved route-level rating name. It needs no entry in `ratings`. */
export const ROUTE_RATING_NAME = "cost" as const;
export type RouteRatingName = typeof ROUTE_RATING_NAME;

export type BandDirection = "higher" | "lower";

export type Band = {
  readonly at: number;
  readonly score: RatingValue;
};

export type Benchmark = {
  readonly bands: readonly Band[];
  readonly direction: BandDirection;
  readonly field: string;
  readonly notes?: string;
  readonly source: string;
  readonly version: string;
};

export type Figure = {
  readonly effort: EffortLevel;
  readonly read: string;
  readonly value: number;
};

/**
 * One override: a written rating the table does not give, with its reason.
 * Exactly one of `model` or `route` is present; the schema enforces it.
 */
export type Override =
  | {
      readonly model: string;
      readonly rating: string;
      readonly reason: string;
      readonly value: RatingValue;
    }
  | {
      readonly rating: string;
      readonly reason: string;
      readonly route: string;
      readonly value: RatingValue;
    };

export type Calibration = {
  readonly benchmarks?: Readonly<Record<string, Benchmark>>;
  readonly feeds?: Readonly<Record<string, readonly string[]>>;
  readonly figures?: Readonly<Record<string, Readonly<Record<string, Figure>>>>;
  readonly handSet?: readonly string[];
  readonly notes?: string;
  readonly overrides?: readonly Override[];
};

export interface RegistryFacts {
  readonly calibration?: Calibration;
  readonly capabilities?: Readonly<Record<string, string>>;
  readonly meters?: Readonly<Record<string, Meter>>;
  readonly models: Readonly<Record<string, Model>>;
  readonly ratings?: Readonly<Record<string, string>>;
}

/** Foreign top-level sections hold any non-null JSON value with finite numbers. */
export type ForeignSections = {
  [section: string]: JsonValue;
};

/** The top-level sections that declare the names models and routes reference. */
export const DECLARATION_SECTIONS = ["ratings", "capabilities", "meters", "calibration"] as const;

export type DeclarationSection = (typeof DECLARATION_SECTIONS)[number];

/** Each declaration section's shape in a registry file. */
type DeclarationMembers = {
  calibration: Calibration;
  capabilities: Record<string, string>;
  meters: Record<string, Meter>;
  ratings: Record<string, string>;
};

export type ProfileDeclaration = {
  description: string;
  routes: RouteLabel[];
  gaps?: ProfileGap[];
};

/** One accepted rating gap: a ceiling the profile accepts, with its reason. */
export type RatingGap = {
  readonly rating: string;
  readonly accepts: RatingValue;
  readonly reason: string;
};

/** One accepted capability gap: a waived capability, with its reason. */
export type CapabilityGap = {
  readonly capability: string;
  readonly reason: string;
};

/** One accepted gap record: exactly one of a rating ceiling or a waived capability. */
export type ProfileGap = RatingGap | CapabilityGap;

export type Profile = {
  readonly description?: string;
  readonly routes: readonly RouteLabel[];
  readonly gaps?: readonly Readonly<ProfileGap>[];
};

export type ProfileProvenance = "implicit" | "declared";

export type RegistryFile = {
  format: 1;
  models: Record<string, Model>;
  profiles?: Record<string, ProfileDeclaration>;
} & {
  [Section in DeclarationSection]?: DeclarationMembers[Section];
} & ForeignSections;

export type IndexedRoute = Route & { model: string };

export interface LoadedRegistry {
  readonly profiles: Readonly<Record<string, Profile>>;
  readonly profileProvenance: Readonly<Record<string, ProfileProvenance>>;
  readonly digest: RegistryDigest;
  readonly format: 1;
  readonly path: string;
  readonly registry: RegistryFacts;
  readonly routes: Readonly<Record<RouteLabel, IndexedRoute>>;
  readonly sections: Readonly<Record<string, JsonValue>>;
}

export interface LoadRegistryOptions {
  path?: string;
}

export interface RegistryProblem {
  code: RegistryErrorCode;
  field: string;
  fix: string;
  message: string;
}

export interface RegistryErrorDetails {
  code: RegistryErrorCode;
  fix: string;
  message: string;
  path: string;
  problems: RegistryProblem[];
}
