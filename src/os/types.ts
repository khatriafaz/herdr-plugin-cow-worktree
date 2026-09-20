export interface CloneRequest {
  source: string;
  destination: string;
  excludedRelativePaths?: readonly string[];
}

export interface CloneReport {
  destination: string;
  filesCloned: number;
  directoriesCreated: number;
  symlinksCreated: number;
  skippedSpecialFiles: string[];
}

export interface WorktreeOsContract {
  readonly platform: "darwin" | "linux";
  validateCapability(request: CloneRequest): Promise<void>;
  cloneCheckout(request: CloneRequest): Promise<CloneReport>;
  cleanup(): Promise<void>;
}
