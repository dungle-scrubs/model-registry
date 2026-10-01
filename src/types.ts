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
  | "rating-mismatch";

export type RatingValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Meter = {
  readonly notes?: string;
  /** The RFC writes spendToZero: true; only that exact value is accepted. */
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

export interface RegistryFacts {
  readonly capabilities?: Readonly<Record<string, string>>;
  readonly meters?: Readonly<Record<string, Meter>>;
  readonly models: Readonly<Record<string, Model>>;
  readonly ratings?: Readonly<Record<string, string>>;
}

/** Foreign top-level sections hold any non-null JSON value with finite numbers. */
export type ForeignSections = {
  [section: string]: JsonValue;
};

export type RegistryFile = {
  format: 1;
  ratings?: Record<string, string>;
  capabilities?: Record<string, string>;
  meters?: Record<string, Meter>;
  models: Record<string, Model>;
} & ForeignSections & {
    /** calibration stays rejected until issue #24 enables it. */
    calibration?: never;
  };

export type IndexedRoute = Route & { model: string };

export interface LoadedRegistry {
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
