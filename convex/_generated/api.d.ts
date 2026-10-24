/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agentInternal from "../agentInternal.js";
import type * as agentRunner from "../agentRunner.js";
import type * as approvals from "../approvals.js";
import type * as approverGuard from "../approverGuard.js";
import type * as autonomy from "../autonomy.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as deadlines from "../deadlines.js";
import type * as demoAuth from "../demoAuth.js";
import type * as grants from "../grants.js";
import type * as ingest from "../ingest.js";
import type * as passcode from "../passcode.js";
import type * as pdfText from "../pdfText.js";
import type * as precedentUtil from "../precedentUtil.js";
import type * as report from "../report.js";
import type * as runGuard from "../runGuard.js";
import type * as settings from "../settings.js";
import type * as ui from "../ui.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentInternal: typeof agentInternal;
  agentRunner: typeof agentRunner;
  approvals: typeof approvals;
  approverGuard: typeof approverGuard;
  autonomy: typeof autonomy;
  crons: typeof crons;
  dashboard: typeof dashboard;
  deadlines: typeof deadlines;
  demoAuth: typeof demoAuth;
  grants: typeof grants;
  ingest: typeof ingest;
  passcode: typeof passcode;
  pdfText: typeof pdfText;
  precedentUtil: typeof precedentUtil;
  report: typeof report;
  runGuard: typeof runGuard;
  settings: typeof settings;
  ui: typeof ui;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
