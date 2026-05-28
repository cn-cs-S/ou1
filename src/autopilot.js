export function createAutopilot({ runPlan, appendLog }) {
  const records = new Map();

  function ensureRecord(accountId = "default") {
    const id = String(accountId || "default");
    if (!records.has(id)) {
      records.set(id, {
        timer: null,
        state: {
          enabled: false,
          intervalSeconds: 30,
          executionMode: "analysis",
          dryRun: true,
          accountId: id,
          settings: {},
          lastRunAt: null,
          nextRunAt: null,
          lastResult: null,
          running: false
        }
      });
    }
    return records.get(id);
  }

  async function configure(input = {}) {
    const accountId = String(input.accountId || "default");
    const record = ensureRecord(accountId);
    const state = record.state;
    stopTimer(record);

    state.enabled = Boolean(input.enabled);
    state.intervalSeconds = clamp(Number(input.intervalSeconds || Number(input.intervalMinutes || 0) * 60 || 30), 30, 3600);
    state.executionMode = ["analysis", "semi", "auto"].includes(input.executionMode) ? input.executionMode : "analysis";
    state.dryRun = input.dryRun !== false;
    state.settings = input.settings || {};
    state.nextRunAt = state.enabled ? nextAt(state.intervalSeconds) : null;

    if (state.enabled) {
      record.timer = setInterval(() => {
        runOnce("schedule", accountId).catch((error) => {
          appendLog?.({
            level: "error",
            event: "autopilot_failed",
            message: `${accountId}: ${error.message}`
          });
        });
      }, state.intervalSeconds * 1000);
      record.timer.unref?.();
    }

    appendLog?.({
      level: "info",
      event: state.enabled ? "autopilot_enabled" : "autopilot_disabled",
      message: state.enabled
        ? `Autopilot enabled for ${accountId}; evaluating every ${state.intervalSeconds} seconds.`
        : `Autopilot stopped for ${accountId}.`,
      meta: { accountId, dryRun: state.dryRun, executionMode: state.executionMode }
    });

    return getState(accountId);
  }

  async function runOnce(reason = "manual", accountId = "default") {
    const record = ensureRecord(accountId);
    const state = record.state;
    if (state.running) {
      return { skipped: true, reason: "already_running", state: getState(accountId) };
    }

    state.running = true;
    try {
      const result = await runPlan({
        settings: state.settings,
        executionMode: state.executionMode,
        dryRun: state.dryRun,
        reason,
        accountId: state.accountId
      });
      state.lastRunAt = new Date().toISOString();
      state.nextRunAt = state.enabled ? nextAt(state.intervalSeconds) : null;
      state.lastResult = result;
      appendLog?.({
        level: "info",
        event: "autopilot_run",
        message: `Autopilot run completed for ${state.accountId} in ${state.executionMode} mode.`,
        meta: {
          accountId: state.accountId,
          dryRun: state.dryRun,
          actions: result?.execution?.results?.length || 0
        }
      });
      return result;
    } finally {
      state.running = false;
    }
  }

  function getState(accountId = "default") {
    const state = ensureRecord(accountId).state;
    return {
      ...state,
      intervalMinutes: state.intervalSeconds / 60,
      settings: { ...state.settings },
      lastResult: state.lastResult ? summarizeResult(state.lastResult) : null
    };
  }

  function getStates() {
    return [...records.keys()].map((accountId) => getState(accountId));
  }

  function remove(accountId) {
    const record = records.get(String(accountId || ""));
    if (!record) return;
    stopTimer(record);
    records.delete(String(accountId));
  }

  function stopTimer(record) {
    if (record.timer) {
      clearInterval(record.timer);
      record.timer = null;
    }
  }

  return {
    configure,
    runOnce,
    getState,
    getStates,
    remove
  };
}

function summarizeResult(result) {
  return {
    generatedAt: result?.plan?.generatedAt || null,
    best: result?.plan?.best || null,
    confidence: result?.plan?.confidence || 0,
    cashReserve: result?.plan?.cashReserve || 0,
    orderCount: result?.plan?.orderPlan?.length || 0,
    executed: (result?.execution?.results || []).filter((item) => item.status === "applied-to-test-account").length,
    dryRun: Boolean(result?.execution?.dryRun),
    actions: (result?.execution?.results || []).slice(0, 10).map((item) => ({
      instId: item.instId,
      action: item.action || item.side || "",
      operation: item.operation || "",
      status: item.status,
      reason: item.reason || ""
    }))
  };
}

function nextAt(intervalSeconds) {
  return new Date(Date.now() + intervalSeconds * 1000).toISOString();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
