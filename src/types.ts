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

export type Route = {
  readonly cost?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  readonly harness: string;
  readonly hosted: boolean;
  readonly modelId: string;
  readonly notes?: string;
  readonly privacyEligible?: boolean;
  readonly provider?: string;
  readonly rateLimitRpm?: number;
  readonly responseSeconds?: number;
};

export type Model = {
  readonly family: string;
  readonly notes?: string;
  readonly routes: readonly Route[];
};

export interface RegistryFacts {
  readonly models: Readonly<Record<string, Model>>;
}

/** Foreign top-level sections hold any non-null JSON value with finite numbers. */
export type ForeignSections = {
  [section: string]: JsonValue;
};

export type RegistryFile = {
  format: 1;
  models: Record<string, Model>;
} & ForeignSections & {
    // Deferred owned sections stay rejected until their format slice ships.
    calibration?: never;
    capabilities?: never;
    meters?: never;
    ratings?: never;
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
