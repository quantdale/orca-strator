import type { ChildProcess } from "node:child_process";
import type {
  CapabilityErrorClass,
  CapabilityIssue,
  CapabilityReadiness,
  ExecutorRichCapabilities,
  OpenCodeApiGeneration,
  OpenCodeCapabilityDetails,
  OpenCodeRouteReadiness
} from "@orca/shared";
import { WindowsPowerShellAdapter } from "./windows-adapter.js";
import { WslAdapter } from "./wsl-adapter.js";
import type {
  ExecutionContext,
  ExecutorAdapter,
  ExecutorAdapterCapabilities,
  ExecutorProbeContext
} from "./executor-adapter.js";

type JsonRecord = Record<string, unknown>;
type FetchOptions = Parameters<typeof fetch>[1];

export interface OpenCodeAdapterOptions {
  endpoint?: string | null;
  requestTimeoutMs?: number;
  windowsAdapter?: ExecutorAdapter;
  wslAdapter?: ExecutorAdapter;
  fetchImpl?: typeof fetch;
}

export interface OpenCodeProbeResult {
  details: OpenCodeCapabilityDetails;
  capabilities: ExecutorAdapterCapabilities;
  issues: CapabilityIssue[];
}

export interface OpenCodeSessionOptions {
  directory?: string;
  title?: string;
}

export interface OpenCodePermissionReply {
  reply: string;
  answers?: string[];
}

export class OpenCodeAdapterError extends Error {
  constructor(
    readonly code: Extract<CapabilityErrorClass, "OPENCODE_ENDPOINT_NOT_CONFIGURED" | "OPENCODE_UNAVAILABLE" | "OPENCODE_API_UNSUPPORTED" | "OPENCODE_API_DRIFT">,
    message: string
  ) {
    super(message);
    this.name = "OpenCodeAdapterError";
  }
}

const UNKNOWN_ROUTES: OpenCodeRouteReadiness = {
  health: "UNKNOWN",
  openApiDocument: "UNKNOWN",
  events: "UNKNOWN",
  sessions: "UNKNOWN",
  sessionHistory: "UNKNOWN",
  prompt: "UNKNOWN",
  wait: "UNKNOWN",
  cancellation: "UNKNOWN",
  permissions: "UNKNOWN",
  modelProviderVisibility: "UNKNOWN",
  subagents: "UNKNOWN",
  usage: "UNKNOWN"
};

const UNSUPPORTED_ROUTES: OpenCodeRouteReadiness = {
  health: "NOT_READY",
  openApiDocument: "UNSUPPORTED",
  events: "UNSUPPORTED",
  sessions: "UNSUPPORTED",
  sessionHistory: "UNSUPPORTED",
  prompt: "UNSUPPORTED",
  wait: "UNSUPPORTED",
  cancellation: "UNSUPPORTED",
  permissions: "UNSUPPORTED",
  modelProviderVisibility: "UNSUPPORTED",
  subagents: "UNSUPPORTED",
  usage: "UNSUPPORTED"
};

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function sanitizeEndpoint(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function routeMatches(paths: string[], patterns: RegExp[]): boolean {
  return paths.some((path) => patterns.some((pattern) => pattern.test(path)));
}

function routeReadiness(pathsKnown: boolean, present: boolean): CapabilityReadiness {
  if (!pathsKnown) return "UNKNOWN";
  return present ? "READY" : "UNSUPPORTED";
}

function apiGeneration(paths: string[]): OpenCodeApiGeneration {
  const relevant = paths.filter((path) =>
    /(?:session|event|permission|provider|health)/i.test(path)
  );
  const hasV2 = relevant.some((path) => path.startsWith("/api/"));
  const hasV1 = relevant.some((path) => !path.startsWith("/api/"));
  if (hasV1 && hasV2) return "HYBRID";
  if (hasV2) return "V2";
  if (hasV1) return "V1";
  return "UNKNOWN";
}

function serverVersion(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  return asString(record.version) ?? asString(asRecord(record.data)?.version);
}

function extractMessages(value: unknown): JsonRecord[] {
  const root = asRecord(value);
  const candidate = Array.isArray(value) ? value : root && Array.isArray(root.messages) ? root.messages : root?.data;
  if (!Array.isArray(candidate)) return [];
  return candidate.map(asRecord).filter((item): item is JsonRecord => item !== null);
}

function sumInto(target: { value: number | null }, value: number | null): void {
  if (value === null) return;
  target.value = (target.value ?? 0) + value;
}

/**
 * Optional OpenCode backend.
 *
 * The child-process path is deliberately the same ExecutorRunner contract as
 * every other adapter. The HTTP surface is an explicit, guarded capability for
 * users who have configured an OpenCode server; it is never required for the
 * ordinary Orca loop.
 */
export class OpenCodeAdapter implements ExecutorAdapter {
  private readonly endpoint: string | null;
  private readonly requestTimeoutMs: number;
  private readonly windowsAdapter: ExecutorAdapter;
  private readonly wslAdapter: ExecutorAdapter;
  private readonly fetchImpl: typeof fetch;
  private lastDetails: OpenCodeCapabilityDetails | null = null;
  private lastPaths: string[] = [];
  private lastUsage: Record<string, number | string | null> = {};
  private readonly childDelegates = new Map<number, ExecutorAdapter>();

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.endpoint = sanitizeEndpoint(options.endpoint === undefined ? process.env.ORCA_OPENCODE_SERVER_URL : options.endpoint);
    this.requestTimeoutMs = Math.max(100, options.requestTimeoutMs ?? 5_000);
    this.windowsAdapter = options.windowsAdapter ?? new WindowsPowerShellAdapter();
    this.wslAdapter = options.wslAdapter ?? new WslAdapter();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  capabilities(context?: Partial<ExecutionContext>): ExecutorAdapterCapabilities {
    const environment = context?.wslDistribution || context?.env?.ORCA_ENVIRONMENT === "wsl" ? "wsl" : "windows";
    const details = this.lastDetails;
    const rich = this.richCapabilities(details);
    return {
      environment,
      headless: "READY",
      cancellation: "READY",
      pause: "READY",
      resume: rich.sessionResume,
      structuredEvents: rich.structuredEvents,
      permissionApi: rich.permissionApi,
      usageTelemetry: rich.usageTelemetry,
      sessionResume: rich.sessionResume,
      sessionHistory: rich.sessionHistory
    };
  }

  async probe(_context: ExecutorProbeContext): Promise<ExecutorAdapterCapabilities> {
    const result = await this.probeServer();
    return result.capabilities;
  }

  getLastProbe(): OpenCodeProbeResult | null {
    if (!this.lastDetails) return null;
    return {
      details: this.lastDetails,
      capabilities: this.capabilities(),
      issues: []
    };
  }

  async probeServer(endpointOverride?: string | null): Promise<OpenCodeProbeResult> {
    const observedAt = new Date().toISOString();
    const endpoint = sanitizeEndpoint(endpointOverride === undefined ? this.endpoint : endpointOverride);
    const issues: CapabilityIssue[] = [];

    if (!endpoint) {
      const details: OpenCodeCapabilityDetails = {
        adapter: "OPENCODE",
        experimental: true,
        endpoint: null,
        apiGeneration: "UNKNOWN",
        serverVersion: null,
        routes: { ...UNKNOWN_ROUTES },
        observedAt
      };
      this.lastDetails = details;
      this.lastPaths = [];
      issues.push({
        class: "OPENCODE_ENDPOINT_NOT_CONFIGURED",
        message: "OpenCode server probe skipped: no explicit endpoint is configured.",
        retryable: false
      });
      return { details, capabilities: this.capabilities(), issues };
    }

    let healthBody: unknown = null;
    let healthSucceeded = false;
    for (const route of ["/api/global/health", "/global/health"]) {
      try {
        const response = await this.requestJson(endpoint, route, { method: "GET" });
        if (response.status >= 200 && response.status < 300) {
          healthBody = response.body;
          healthSucceeded = true;
          break;
        }
      } catch (error) {
        if (error instanceof OpenCodeAdapterError && error.code === "OPENCODE_API_DRIFT") {
          issues.push({ class: error.code, message: error.message, retryable: false });
        }
      }
    }

    if (!healthSucceeded) {
      issues.push({
        class: "OPENCODE_UNAVAILABLE",
        message: `OpenCode server health was not reachable at ${endpoint}.`,
        retryable: true
      });
    }

    let paths: string[] = [];
    let documentSucceeded = false;
    try {
      const document = await this.requestJson(endpoint, "/doc", { method: "GET" });
      const documentRecord = asRecord(document.body);
      const rawPaths = documentRecord?.paths;
      const pathsRecord = asRecord(rawPaths);
      if (document.status >= 200 && document.status < 300 && pathsRecord) {
        paths = Object.keys(pathsRecord);
        documentSucceeded = true;
      } else if (document.status !== 404) {
        issues.push({
          class: "OPENCODE_API_DRIFT",
          message: "OpenCode /doc did not return an OpenAPI path map.",
          retryable: false
        });
      }
    } catch (error) {
      if (error instanceof OpenCodeAdapterError) {
        issues.push({ class: error.code, message: error.message, retryable: error.code === "OPENCODE_UNAVAILABLE" });
      }
    }

    if (!documentSucceeded && healthSucceeded) {
      issues.push({
        class: "OPENCODE_API_UNSUPPORTED",
        message: "OpenCode health is available but its OpenAPI document is unavailable or incompatible; native features remain experimental and unverified.",
        retryable: false
      });
    }

    this.lastPaths = paths;
    const routes = this.routes(paths, healthSucceeded, documentSucceeded);
    const details: OpenCodeCapabilityDetails = {
      adapter: "OPENCODE",
      experimental: true,
      endpoint,
      apiGeneration: apiGeneration(paths),
      serverVersion: serverVersion(healthBody),
      routes,
      observedAt
    };
    this.lastDetails = details;
    return { details, capabilities: this.capabilities(), issues };
  }

  spawn(context: ExecutionContext): ChildProcess {
    const delegate = this.delegate(context);
    const child = delegate.spawn(context);
    if (child.pid) {
      this.childDelegates.set(child.pid, delegate);
      const forget = () => {
        if (child.pid) this.childDelegates.delete(child.pid);
      };
      child.once("exit", forget);
      child.once("error", forget);
    }
    return child;
  }

  async killProcessTree(child: ChildProcess): Promise<void> {
    await this.delegateForChild(child).killProcessTree(child);
  }

  async cancel(child: ChildProcess, reason?: string): Promise<void> {
    const delegate = this.delegateForChild(child);
    if (delegate.cancel) await delegate.cancel(child, reason);
    else await delegate.killProcessTree(child);
  }

  async pause(child: ChildProcess): Promise<void> {
    const delegate = this.delegateForChild(child);
    if (delegate.pause) await delegate.pause(child);
    else await this.cancel(child, "pause");
  }

  async status(child: ChildProcess): Promise<{ state: string; detail?: string }> {
    const delegate = this.delegateForChild(child);
    return delegate.status ? delegate.status(child) : { state: child.exitCode === null ? "RUNNING" : "EXITED" };
  }

  /** Create a native session only after a successful explicit probe. */
  async createSession(options: OpenCodeSessionOptions = {}): Promise<unknown> {
    const route = this.requireRoute("sessions", (path) => path === "/api/session" || path === "/session");
    const body: JsonRecord = {};
    if (options.directory) body.directory = options.directory;
    if (options.title) body.title = options.title;
    return this.nativeRequest(route, { method: "POST", body: JSON.stringify(body) });
  }

  /** Submit a native prompt; this is an explicit model/provider operation. */
  async prompt(sessionId: string, prompt: string, model?: { providerID: string; modelID: string }): Promise<unknown> {
    const route = this.requireRoute("prompt", (path) => /\/session\/[^/]+\/(?:prompt|message|prompt_async)$/.test(path));
    const v2 = route.startsWith("/api/");
    const body: JsonRecord = v2
      ? {
          sessionID: sessionId,
          prompt: { role: "user", parts: [{ type: "text", text: prompt }] },
          delivery: "immediate"
        }
      : { parts: [{ type: "text", text: prompt }] };
    if (model && v2) body.model = model;
    return this.nativeRequest(this.expandSessionRoute(route, sessionId), { method: "POST", body: JSON.stringify(body) });
  }

  async wait(sessionId: string): Promise<unknown> {
    const route = this.requireRoute("wait", (path) => /\/session\/[^/]+\/(?:wait|status)$/.test(path));
    const method = route.endsWith("/wait") ? "POST" : "GET";
    return this.nativeRequest(this.expandSessionRoute(route, sessionId), { method });
  }

  async cancelSession(sessionId: string): Promise<unknown> {
    const route = this.requireRoute("cancellation", (path) => /\/session\/[^/]+\/(?:abort|cancel|interrupt)$/.test(path));
    return this.nativeRequest(this.expandSessionRoute(route, sessionId), { method: "POST" });
  }

  async replyPermission(permissionId: string, reply: OpenCodePermissionReply): Promise<unknown> {
    const route = this.requireRoute("permissions", (path) => /\/permission(?:\/[^/]+\/reply)?$/.test(path));
    const expanded = route.includes(":") || route.includes("{") ? this.expandPermissionRoute(route, permissionId) : `${route}/${encodeURIComponent(permissionId)}/reply`;
    return this.nativeRequest(expanded, { method: "POST", body: JSON.stringify(reply) });
  }

  async listMessages(sessionId: string): Promise<unknown> {
    const route = this.requireRoute("sessionHistory", (path) => /\/session\/[^/]+\/(?:message|messages|history)$/.test(path));
    const value = await this.nativeRequest(this.expandSessionRoute(route, sessionId), { method: "GET" });
    const record = asRecord(value);
    if (!Array.isArray(value) && !Array.isArray(record?.messages) && !Array.isArray(record?.data)) {
      throw new OpenCodeAdapterError("OPENCODE_API_DRIFT", "OpenCode session history response did not contain a message list.");
    }
    return value;
  }

  async readSessionUsage(sessionId: string): Promise<Record<string, number | string | null>> {
    const messages = await this.listMessages(sessionId);
    this.lastUsage = this.extractUsage(messages);
    const hasStructuredUsage = [
      "inputTokens",
      "cachedInputTokens",
      "outputTokens",
      "reasoningTokens",
      "requestCount",
      "latencyMs",
      "exactCost"
    ].some((key) => this.lastUsage[key] !== null && this.lastUsage[key] !== undefined);
    if (hasStructuredUsage && this.lastDetails) {
      this.lastDetails = {
        ...this.lastDetails,
        routes: { ...this.lastDetails.routes, usage: "READY" }
      };
    }
    return { ...this.lastUsage };
  }

  async listProviders(): Promise<unknown> {
    const route = this.requireRoute("modelProviderVisibility", (path) => /\/provider(?:\/|$)/.test(path));
    return this.nativeRequest(route, { method: "GET" });
  }

  async listSubagents(): Promise<unknown> {
    const route = this.requireRoute("subagents", (path) => /subagent/i.test(path));
    return this.nativeRequest(route, { method: "GET" });
  }

  /**
   * Consume the observed SSE stream until its caller aborts the supplied
   * signal. The stream is intentionally not used as Orca's durable event log.
   */
  async subscribeEvents(onEvent: (event: unknown) => void, signal?: AbortSignal): Promise<void> {
    const route = this.requireRoute("events", (path) => path === "/api/event" || path === "/event" || path === "/global/event");
    const response = await this.nativeResponse(route, { method: "GET", headers: { Accept: "text/event-stream" } }, signal);
    if (!response.body) throw new OpenCodeAdapterError("OPENCODE_API_DRIFT", "OpenCode event endpoint returned no stream body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const value = line.slice(5).trim();
        if (!value) continue;
        try { onEvent(JSON.parse(value) as unknown); }
        catch { onEvent(value); }
      }
    }
  }

  usage(): Promise<Record<string, number | string | null>> {
    return Promise.resolve({ ...this.lastUsage });
  }

  private routes(paths: string[], healthSucceeded: boolean, documentSucceeded: boolean): OpenCodeRouteReadiness {
    if (!documentSucceeded) {
      return healthSucceeded ? { ...UNKNOWN_ROUTES, health: "READY", openApiDocument: "UNSUPPORTED" } : { ...UNSUPPORTED_ROUTES };
    }
    const has = (patterns: RegExp[]) => routeMatches(paths, patterns);
    const sessions = has([/^\/api\/session(?:\/|$)/, /^\/session(?:\/|$)/]);
    const history = has([/\/session\/[^/]+\/(?:message|messages|history)$/]);
    return {
      health: healthSucceeded ? "READY" : "NOT_READY",
      openApiDocument: "READY",
      events: routeReadiness(true, has([/^\/api\/event$/, /^\/event$/, /^\/global\/event$/])),
      sessions: routeReadiness(true, sessions),
      sessionHistory: routeReadiness(true, history),
      prompt: routeReadiness(true, has([/\/session\/[^/]+\/(?:prompt|message|prompt_async)$/])),
      wait: routeReadiness(true, has([/\/session\/[^/]+\/(?:wait|status)$/])),
      cancellation: routeReadiness(true, has([/\/session\/[^/]+\/(?:abort|cancel|interrupt)$/])),
      permissions: routeReadiness(true, has([/^\/api\/permission(?:\/|$)/, /^\/permission(?:\/|$)/])),
      modelProviderVisibility: routeReadiness(true, has([/\/provider(?:\/|$)/, /\/model(?:\/|$)/])),
      subagents: routeReadiness(true, has([/subagent/i])),
      // A message/history route is only evidence that structured usage may be
      // retrievable. Numeric usage is still UNKNOWN until readSessionUsage().
      usage: sessions && history ? "UNKNOWN" : "UNSUPPORTED"
    };
  }

  private richCapabilities(details: OpenCodeCapabilityDetails | null): ExecutorRichCapabilities {
    if (!details) {
      return {
        structuredEvents: "UNKNOWN",
        sessionResume: "UNKNOWN",
        subagents: "UNKNOWN",
        permissionApi: "UNKNOWN",
        nativeCancellation: "UNKNOWN",
        sessionHistory: "UNKNOWN",
        usageTelemetry: "UNKNOWN",
        nativeStatus: "UNKNOWN"
      };
    }
    const routes = details.routes;
    return {
      structuredEvents: routes.events,
      sessionResume: routes.sessions === "READY" && routes.sessionHistory === "READY" ? "READY" : routes.sessions === "UNSUPPORTED" ? "UNSUPPORTED" : "UNKNOWN",
      subagents: routes.subagents,
      permissionApi: routes.permissions,
      nativeCancellation: routes.cancellation,
      sessionHistory: routes.sessionHistory,
      usageTelemetry: routes.usage,
      nativeStatus: routes.health
    };
  }

  private delegate(context: ExecutionContext): ExecutorAdapter {
    return context.wslDistribution || context.env.ORCA_ENVIRONMENT === "wsl" ? this.wslAdapter : this.windowsAdapter;
  }

  private delegateForChild(child: ChildProcess): ExecutorAdapter {
    return child.pid ? this.childDelegates.get(child.pid) ?? this.windowsAdapter : this.windowsAdapter;
  }

  private requireRoute(kind: keyof OpenCodeRouteReadiness, predicate: (path: string) => boolean): string {
    if (!this.lastDetails || this.lastDetails.routes[kind] === "UNKNOWN") {
      throw new OpenCodeAdapterError("OPENCODE_API_UNSUPPORTED", `OpenCode ${kind} operation requires a successful explicit capability probe.`);
    }
    const route = this.lastPaths
      .filter(predicate)
      .sort((left, right) => Number(right.startsWith("/api/")) - Number(left.startsWith("/api/")))[0];
    if (!route || this.lastDetails.routes[kind] === "UNSUPPORTED") {
      throw new OpenCodeAdapterError("OPENCODE_API_UNSUPPORTED", `OpenCode ${kind} route was not observed by the last probe.`);
    }
    return route;
  }

  private expandSessionRoute(route: string, sessionId: string): string {
    const encoded = encodeURIComponent(sessionId);
    return route.replace(/\{[^}]+\}|:[A-Za-z][A-Za-z0-9_]*/, encoded);
  }

  private expandPermissionRoute(route: string, permissionId: string): string {
    return route.replace(/\{[^}]+\}|:[A-Za-z][A-Za-z0-9_]*/, encodeURIComponent(permissionId));
  }

  private async nativeRequest(path: string, init: FetchOptions): Promise<unknown> {
    const response = await this.nativeResponse(path, init);
    const text = await response.text();
    if (!text.trim()) return null;
    try { return JSON.parse(text) as unknown; }
    catch { throw new OpenCodeAdapterError("OPENCODE_API_DRIFT", `OpenCode ${path} returned a non-JSON response.`); }
  }

  private async nativeResponse(path: string, init: FetchOptions, signal?: AbortSignal): Promise<Response> {
    const endpoint = this.lastDetails?.endpoint ?? this.endpoint;
    if (!endpoint) throw new OpenCodeAdapterError("OPENCODE_ENDPOINT_NOT_CONFIGURED", "OpenCode server endpoint is not configured.");
    const response = await this.requestRaw(endpoint, path, init, signal);
    if (!response.ok) {
      const code = response.status === 404 ? "OPENCODE_API_UNSUPPORTED" : "OPENCODE_API_DRIFT";
      throw new OpenCodeAdapterError(code, `OpenCode ${path} returned HTTP ${response.status}.`);
    }
    return response;
  }

  private async requestJson(endpoint: string, path: string, init: FetchOptions): Promise<{ status: number; body: unknown }> {
    const response = await this.requestRaw(endpoint, path, init);
    const text = await response.text();
    if (!text.trim()) return { status: response.status, body: null };
    try { return { status: response.status, body: JSON.parse(text) as unknown }; }
    catch { throw new OpenCodeAdapterError("OPENCODE_API_DRIFT", `OpenCode ${path} returned malformed JSON.`); }
  }

  private async requestRaw(endpoint: string, path: string, init: FetchOptions = {}, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const abortExternal = () => controller.abort();
    signal?.addEventListener("abort", abortExternal, { once: true });
    try {
      const response = await this.fetchImpl(`${endpoint}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Accept: "application/json", ...(init.headers ?? {}) }
      });
      return response;
    } catch (error) {
      if (error instanceof OpenCodeAdapterError) throw error;
      throw new OpenCodeAdapterError("OPENCODE_UNAVAILABLE", `OpenCode request ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortExternal);
    }
  }

  private extractUsage(value: unknown): Record<string, number | string | null> {
    const input = { value: null as number | null };
    const cached = { value: null as number | null };
    const output = { value: null as number | null };
    const reasoning = { value: null as number | null };
    const exactCost = { value: null as number | null };
    const latency = { value: null as number | null };
    let requestCount = 0;
    let provider: string | null = null;
    let model: string | null = null;

    for (const message of extractMessages(value)) {
      const info = asRecord(message.info) ?? message;
      if (asString(info.role) && info.role !== "assistant") continue;
      const tokens = asRecord(info.tokens) ?? asRecord(message.tokens);
      if (tokens) {
        sumInto(input, asNumber(tokens.input));
        sumInto(output, asNumber(tokens.output));
        sumInto(reasoning, asNumber(tokens.reasoning));
        const cache = asRecord(tokens.cache);
        sumInto(cached, asNumber(tokens.cachedInput) ?? asNumber(cache?.read));
      }
      const cost = asNumber(info.cost) ?? asNumber(message.cost);
      sumInto(exactCost, cost);
      const time = asRecord(info.time);
      const created = asNumber(time?.created);
      const completed = asNumber(time?.completed);
      if (created !== null && completed !== null && completed >= created) sumInto(latency, completed - created);
      const messageModel = asRecord(info.model) ?? asRecord(message.model);
      provider = provider ?? asString(messageModel?.providerID) ?? asString(messageModel?.provider);
      model = model ?? asString(messageModel?.modelID) ?? asString(messageModel?.model);
      if (tokens || cost !== null) requestCount += 1;
    }

    const result: Record<string, number | string | null> = {
      inputTokens: input.value,
      cachedInputTokens: cached.value,
      outputTokens: output.value,
      reasoningTokens: reasoning.value,
      requestCount: requestCount || null,
      latencyMs: latency.value,
      exactCost: exactCost.value,
      estimatedCost: null,
      provider,
      model,
      currency: null,
      notes: "OpenCode structured assistant-message telemetry; missing provider fields remain unknown."
    };
    return result;
  }
}
