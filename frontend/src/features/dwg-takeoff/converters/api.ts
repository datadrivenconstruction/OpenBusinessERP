// DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/** Local CAD converter management (status, verify, one-click install). */

import { apiGet, apiPost } from '@/shared/lib/api';
import { isModuleLoaded } from '@/shared/lib/moduleProbe';


/* ── Converter Management (preflight + auto-install) ─────────────── */

/** Health states surfaced by the backend smoke test:
 *   - `ok` — binary loads and exits cleanly.
 *   - `failed` — binary doesn't load (DLL missing, perms, etc.).
 *   - `unknown` — install detected, smoke test not yet run (the
 *     `verify=true` query param triggers it).
 *   - `not_installed` — the binary isn't present on disk. */
export type BIMConverterHealth =
  | 'ok'
  | 'failed'
  | 'unknown'
  | 'not_installed';

/** Stable action ids returned by the backend so the UI can render the
 *  correct fix button. New ids are added here as the smoke test learns
 *  to detect more failure modes. */
export type BIMConverterAction =
  | 'install_converter'
  | 'reinstall_converter'
  | 'install_vc_redist'
  | 'unblock_files'
  | 'check_permissions'
  | 'manual_install_from_github';

/** Single DDC converter entry as returned by the backend
 *  `/v1/takeoff/converters/` endpoint. */
export interface BIMConverterInfo {
  /** Stable converter id — one of `'rvt'`, `'dwg'`, `'ifc'`, `'dgn'`. */
  id: string;
  name: string;
  description: string;
  engine: string;
  extensions: string[];
  exe: string;
  version: string;
  size_mb: number;
  installed: boolean;
  path: string | null;
  /** Smoke-test result. Always present from v2.6.23+ (older servers omit
   *  the field — frontend treats missing as `'unknown'`). */
  health?: BIMConverterHealth;
  /** Human-readable explanation when `health !== 'ok'`. */
  health_message?: string;
  /** Stable action ids the UI maps to fix buttons. */
  suggested_actions?: BIMConverterAction[];
}

/** Response payload of `GET /v1/takeoff/converters/`. */
export interface BIMConvertersResponse {
  converters: BIMConverterInfo[];
  installed_count: number;
  /** Number of converters where `health === 'ok'`. Only meaningful when
   *  the request was made with `verify=true`. */
  healthy_count?: number;
  total_count: number;
}

/** Result of `POST /v1/takeoff/converters/{id}/verify/` — force-runs the
 *  smoke test (bypasses the 5-minute cache) and returns fresh health. */
export interface BIMConverterVerifyResult {
  converter_id: string;
  installed: boolean;
  path: string | null;
  health: BIMConverterHealth;
  health_message: string;
  suggested_actions: BIMConverterAction[];
}

/** Result of `POST /v1/takeoff/converters/{id}/install/`.
 *
 * Hardening note (v2.6.22): the backend now always returns a structured
 * response — even on failure paths the body carries `installed: false` plus
 * a concrete `message` and (on Linux) `platform_unsupported: true` with
 * the apt commands the user should run.  The frontend MUST branch on
 * `installed` instead of treating any 2xx as success. */
export interface BIMConverterInstallResult {
  converter_id: string;
  installed: boolean;
  path?: string;
  already_installed?: boolean;
  size_bytes?: number;
  message: string;
  /** Linux / macOS — the OS has no Windows-style auto-install path. */
  platform_unsupported?: boolean;
  /** Linux only — apt package name and a copy-pasteable script. */
  apt_package?: string;
  instructions?: string;
  /** Linux only — true if `/etc/apt/sources.list.d/ddc.list` already
   *  exists, i.e. the user has the DDC apt source and only needs a
   *  single `apt install` line. The toast renders a shorter title in
   *  that case. */
  apt_source_present?: boolean;
  /** Linux only — predicted binary path after install
   *  (e.g. `/usr/bin/RvtExporter`). Surfaced in the toast so the user
   *  knows where the .deb will land before running apt. */
  expected_binary_path?: string | null;
  /** Whether the post-install smoke test passed (Windows only). */
  smoke_test_passed?: boolean;
  platform?: string;
  /** v8.8.0: the download now runs in the background so the request can't be
   *  aborted mid-download ("signal timed out") on slow servers / behind
   *  proxies. When true the POST returned immediately; watch
   *  ``install-progress`` for the terminal ``done``/``error`` stage instead
   *  of treating this response as the final outcome. */
  async_install?: boolean;
  /** True when this call kicked off a fresh background install. */
  started?: boolean;
  /** True when an install for this converter was already in flight. */
  already_running?: boolean;
  /** Initial background stage (``starting``) when ``async_install`` is true. */
  stage?: string;
}

const EMPTY_CONVERTERS: BIMConvertersResponse = {
  converters: [],
  installed_count: 0,
  total_count: 0,
  healthy_count: 0,
};

/** List every DDC converter and its install status.  Shared with the
 *  Quantities page — use the same `['bim-converters']` query key in
 *  any component that renders converter state so cache invalidations
 *  stay in sync.
 *
 *  Pass `verify: true` to also run the per-converter smoke test (cached
 *  5 min server-side). Without it, every installed converter reports
 *  `health: 'unknown'` and the UI shows neutral pills.
 *
 *  When the `oe_takeoff` module is disabled on the server (e.g. user
 *  toggled it off in the Modules page) the request would 404. We probe
 *  `/v1/modules/` once per session and short-circuit — that keeps the
 *  browser's network panel quiet instead of logging an expected 404. */
export async function fetchBIMConverters(
  options: { verify?: boolean } = {},
): Promise<BIMConvertersResponse> {
  if (!(await isModuleLoaded('oe_takeoff'))) {
    return EMPTY_CONVERTERS;
  }
  const url = options.verify
    ? '/v1/takeoff/converters/?verify=true'
    : '/v1/takeoff/converters/';
  try {
    return await apiGet<BIMConvertersResponse>(url);
  } catch (err: unknown) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 404) {
      return EMPTY_CONVERTERS;
    }
    throw err;
  }
}

/** Force-run the smoke test for a single converter, bypassing the
 *  server-side cache. Used by the BIM page's "Re-check" button after
 *  the user manually fixed something (installed VCRedist, unblocked
 *  the files, ran as admin). */
export async function verifyBIMConverter(
  converterId: string,
): Promise<BIMConverterVerifyResult> {
  return apiPost<BIMConverterVerifyResult>(
    `/v1/takeoff/converters/${encodeURIComponent(converterId)}/verify/`,
    {},
  );
}

export interface ConverterVersionEntry {
  id: string;
  name: string;
  exe: string;
  installed: boolean;
  installed_path: string | null;
  installed_size: number | null;
  installed_sha: string | null;
  latest_size: number | null;
  latest_sha: string | null;
  is_outdated: boolean;
  download_url: string | null;
  html_url: string | null;
}

export interface ConverterVersionCheck {
  converters: ConverterVersionEntry[];
  any_outdated: boolean;
  network_ok: boolean;
  checked_at: string;
  ttl_seconds: number;
}

/** Compare each installed DDC converter against the latest on GitHub.
 *
 *  Backend computes git-blob SHA-1 of every locally-installed converter
 *  and matches against GitHub Contents API. Cached server-side for 6 h,
 *  so polling here is cheap. Mounted at the system level (not under the
 *  takeoff module) so it works even when ``oe_takeoff`` is disabled. */
export async function fetchConverterVersionCheck(): Promise<ConverterVersionCheck | null> {
  try {
    // Note: this is a system-level endpoint at /api/system/, not under /api/v1/.
    const r = await fetch('/api/system/converters/version-check', {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    return (await r.json()) as ConverterVersionCheck;
  } catch {
    return null;
  }
}

/** Trigger an auto-install of a DDC converter from GitHub releases.
 *  The request is blocking on the backend (downloads + extracts +
 *  verifies) and typically takes 60–120 s for the RVT converter.
 *
 *  Pass ``force=true`` to bypass the "already installed" short-circuit
 *  and re-download even when a binary is already present — used by the
 *  "Update" button when the version-check banner reports an outdated
 *  converter SHA.
 *
 *  v8.8.0: the backend no longer downloads inline. The POST kicks off a
 *  background download and returns immediately (``async_install: true``),
 *  which is what fixed the user-reported "signal timed out" on slow Ubuntu
 *  servers - a 100-300 MB download could never finish inside any single
 *  request window (and a reverse proxy would cut it even sooner). This
 *  helper then polls the lightweight ``install-progress`` endpoint until the
 *  background task reaches a terminal stage and resolves with the final
 *  result, so every caller (and its in-flight progress bar) keeps working
 *  unchanged - just without one multi-minute HTTP request held open.
 */
export async function installBIMConverter(
  converterId: string,
  options: { force?: boolean } = {},
): Promise<BIMConverterInstallResult> {
  const qs = options.force ? '?force=true' : '';
  // The POST returns at once now, so a short, deterministic signal is enough
  // (guarded for SSR / test stubs without AbortSignal.timeout).
  const signal: AbortSignal | undefined =
    typeof AbortSignal !== 'undefined' &&
    typeof (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout ===
      'function'
      ? (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(
          60_000,
        )
      : undefined;
  let initial: BIMConverterInstallResult;
  try {
    initial = await apiPost<BIMConverterInstallResult>(
      `/v1/takeoff/converters/${encodeURIComponent(converterId)}/install/${qs}`,
      {},
      signal ? { signal } : undefined,
    );
  } catch (err) {
    // The install POST is meant to return at once, but on a busy single-worker
    // backend (e.g. the desktop build mid-BIM-load) it can still exceed the
    // signal, and a flaky link can drop it ("Failed to fetch"). In BOTH cases
    // the backend has very likely already spawned the background download, so
    // treating this as a hard failure is wrong - it spammed users with
    // repeated "signal timed out" toasts. Fall through to the progress poll,
    // which reports the real outcome (or a calm "still downloading"). Only a
    // genuine HTTP error (unknown converter, auth) - which carries a status -
    // is re-thrown.
    const e = err as { isTimeout?: boolean; name?: string; message?: string; status?: number };
    const isTransient =
      e?.isTimeout === true ||
      e?.name === 'AbortError' ||
      (typeof e?.status !== 'number' &&
        /timed out|failed to fetch|networkerror|load failed|aborted/i.test(e?.message ?? ''));
    if (!isTransient) throw err;
    initial = {
      converter_id: converterId,
      installed: false,
      async_install: true,
      message: '',
    } as BIMConverterInstallResult;
  }

  // Back-compat: an older backend ran the install inline and already returned
  // the terminal result; an "already installed" answer is terminal too.
  if (!initial.async_install) return initial;

  // Poll the background install to completion. Each poll is a cheap, fast GET
  // (its own short timeout), so no single request is ever held open for the
  // whole download - the resilient part of the fix.
  const POLL_MS = 1500;
  const MAX_WAIT_MS = 20 * 60 * 1000; // generous: RVT on a slow link
  const startedAt = Date.now();
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  await sleep(POLL_MS);
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    let prog: BIMConverterInstallProgress | null = null;
    try {
      prog = await fetchBIMConverterInstallProgress(converterId);
    } catch {
      // Transient poll failure (slow backend) - keep waiting.
      await sleep(POLL_MS);
      continue;
    }
    if (prog.stage === 'done' || prog.stage === 'error') {
      return {
        converter_id: converterId,
        installed: Boolean(prog.installed),
        path: prog.path,
        message: prog.message ?? initial.message ?? '',
        smoke_test_passed: prog.smoke_test_passed,
        platform: prog.platform,
        platform_unsupported: prog.platform_unsupported,
        apt_package: prog.apt_package,
        apt_source_present: prog.apt_source_present,
        instructions: prog.instructions,
        already_installed: false,
      };
    }
    if (!prog.active) {
      // Progress vanished (backend restart / TTL) with no terminal record.
      break;
    }
    await sleep(POLL_MS);
  }

  // Timed out waiting, or the progress feed dropped. Don't claim failure - the
  // install may still be finishing server-side; tell the caller to re-check.
  return {
    converter_id: converterId,
    installed: false,
    async_install: true,
    message:
      initial.message ||
      'The converter is still downloading in the background. Check the BIM converters panel in a moment.',
  };
}

/** Lightweight progress poll for an in-flight converter install.
 *  Returns ``{active: false}`` when no install is running, or
 *  ``{active: true, stage, current, total, bytes_done, file, started_at}``
 *  while files are downloading. The frontend polls every 500 ms while
 *  the install mutation is pending. */
export interface BIMConverterInstallProgress {
  active: boolean;
  /** Backend stages, in order: ``starting`` (background task spawned) →
   *  ``listing`` (resolving the file/package set) → ``downloading``
   *  (fetching files) → ``extracting`` (Windows has none; Linux unpacks .deb
   *  archives here) → ``verifying`` (post-install smoke test) → terminal
   *  ``done`` / ``error``. The terminal stages carry the outcome so the
   *  frontend can finalize without holding the install request open. */
  stage?:
    | 'starting'
    | 'listing'
    | 'downloading'
    | 'extracting'
    | 'verifying'
    | 'done'
    | 'error';
  current?: number;
  total?: number;
  bytes_done?: number;
  file?: string | null;
  started_at?: number;
  /** Terminal record fields (present when ``stage`` is ``done``/``error``). */
  installed?: boolean;
  message?: string;
  error?: string;
  instructions?: string;
  apt_package?: string;
  apt_source_present?: boolean;
  platform_unsupported?: boolean;
  smoke_test_passed?: boolean;
  path?: string;
  platform?: string;
  finished_at?: number;
}

export async function fetchBIMConverterInstallProgress(
  converterId: string,
): Promise<BIMConverterInstallProgress> {
  return apiGet<BIMConverterInstallProgress>(
    `/v1/takeoff/converters/${encodeURIComponent(converterId)}/install-progress/`,
  );
}
