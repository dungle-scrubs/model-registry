export type JsonValue = string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

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

export type Route = {
  harness: string;
  modelId: string;
  provider?: string;
  hosted: boolean;
  privacyEligible?: boolean;
  cost?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  rateLimitRpm?: number;
  responseSeconds?: number;
  notes?: string;
};

export type Model = {
  family: string;
  notes?: string;
  routes: Route[];
};

export interface RegistryFacts {
  models: Record<string, Model>;
}

/** Foreign top-level sections hold any non-null JSON value with finite numbers. */
export type ForeignSections = {
  [section: string]: JsonValue;
};

/** Deferred owned sections stay rejected until their format slice ships. */
export type DeferredRegistryFields = {
  ratings?: never;
  capabilities?: never;
  meters?: never;
  calibration?: never;
};

export type RegistryFile = {
  format: 1;
  models: Record<string, Model>;
} & ForeignSections &
  DeferredRegistryFields;

export type IndexedRoute = Route & { model: string };

export interface LoadedRegistry {
  format: 1;
  digest: RegistryDigest;
  path: string;
  registry: RegistryFacts;
  routes: Record<RouteLabel, IndexedRoute>;
  sections: Record<string, JsonValue>;
}

export interface LoadRegistryOptions {
  path?: string;
}

export interface RegistryProblem {
  code: RegistryErrorCode;
  field: string;
  message: string;
  fix: string;
}

export interface RegistryErrorDetails {
  code: RegistryErrorCode;
  message: string;
  fix: string;
  path: string;
  problems: RegistryProblem[];
}
