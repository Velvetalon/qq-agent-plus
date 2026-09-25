import {
  DEFAULT_REFLECTION_LIMITS,
  ReflectionError,
  ReflectionStore,
  hashBasePersona,
  reflectionPrompt,
  validateReflectionOutput
} from './reflection-store.js';

function valueOrCall(value, fallback = undefined) {
  return typeof value === 'function' ? value() : value ?? fallback;
}

function stoppedError(reason = 'reflection worker stopped') {
  const error = new Error(reason);
  error.code = 'REFLECTION_STOPPED';
  return error;
}

export class ReflectionWorker {
  constructor({
    store,
    reflector,
    owner = `reflection-${process.pid}`,
    limits = DEFAULT_REFLECTION_LIMITS,
    now = () => Date.now()
  } = {}) {
    if (!(store instanceof ReflectionStore)) throw new TypeError('ReflectionStore is required');
    if (typeof reflector !== 'function') throw new TypeError('reflector function is required');
    this.store = store;
    this.reflector = reflector;
    this.owner = String(owner || `reflection-${process.pid}`);
    this.limits = { ...DEFAULT_REFLECTION_LIMITS, ...limits };
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.active = false;
    this.generation = 0;
    this.controller = null;
    this.timer = null;
    this.inFlight = null;
    this.services = null;
    this.options = {};
  }

  get status() {
    return {
      active: this.active,
      generation: this.generation,
      owner: this.owner,
      inFlight: Boolean(this.inFlight)
    };
  }

  start({
    enabled = true,
    services = null,
    pollIntervalMs = 1000,
    basePersona = null,
    getBasePersona = null,
    getMode = null,
    getExpectedProfileRevision = null,
    notebook = null
  } = {}) {
    if (enabled !== true) return { started: false, reason: 'disabled' };
    if (this.active) return { started: true, generation: this.generation };
    this.generation = this.store.beginWorkerGeneration({ owner: this.owner });
    this.controller = new AbortController();
    this.services = services;
    this.options = {
      pollIntervalMs: Math.max(1, Number(pollIntervalMs) || 1000),
      basePersona,
      getBasePersona,
      getMode,
      getExpectedProfileRevision,
      notebook
    };
    this.active = true;
    this.#schedule(this.options.pollIntervalMs);
    return { started: true, generation: this.generation };
  }

  async stop(reason = 'stopped', { timeoutMs = 1000 } = {}) {
    if (!this.active && !this.inFlight) return { stopped: true, reason };
    this.active = false;
    this.#clearTimer();
    this.controller?.abort(stoppedError(reason));
    const generation = this.generation;
    this.store.releaseWorkerLease({ owner: this.owner, generation, reason });
    const pending = this.inFlight;
    if (pending) {
      await Promise.race([
        pending.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(timeoutMs) || 1000)))
      ]);
    }
    return { stopped: true, reason, generation };
  }

  async runOnce({
    basePersona = this.options.basePersona,
    mode = null,
    expectedProfileRevision = null,
    notebook = this.options.notebook
  } = {}) {
    if (!this.active || this.controller?.signal.aborted) {
      return { status: 'inactive', modelCalls: 0, committed: false };
    }
    if (this.inFlight) return { status: 'busy', modelCalls: 0, committed: false };
    const task = this.#runOnceInner({
      basePersona,
      mode,
      expectedProfileRevision,
      notebook
    });
    this.inFlight = task;
    try {
      return await task;
    } finally {
      if (this.inFlight === task) this.inFlight = null;
    }
  }

  async runDrain({ maxJobs = 1 } = {}) {
    const results = [];
    const limit = Math.max(1, Math.min(100, Number(maxJobs) || 1));
    for (let index = 0; index < limit; index += 1) {
      const result = await this.runOnce();
      results.push(result);
      if (!['completed', 'noop'].includes(result.status)) break;
    }
    return results;
  }

  async #runOnceInner({ basePersona, mode, expectedProfileRevision, notebook }) {
    const signal = this.controller.signal;
    const claimed = this.store.claimNextJob({
      owner: this.owner,
      generation: this.generation,
      leaseMs: this.limits.leaseMs,
      workerLeaseMs: this.limits.workerLeaseMs
    });
    if (!claimed.job) {
      return { status: claimed.status, modelCalls: 0, committed: false };
    }
    const job = claimed.job;
    if (this.store.hasProcessedEvidence({
      accountId: job.accountId,
      observerId: job.observerId,
      evidenceHash: job.evidenceHash
    })) {
      const noop = this.store.completeNoop({
        job,
        owner: this.owner,
        generation: this.generation,
        reason: 'no-new-evidence'
      });
      return { status: 'noop', modelCalls: 0, committed: noop.accepted === true, jobId: job.id };
    }
    if (signal.aborted || !this.active) {
      return { status: 'stopped', modelCalls: 0, committed: false, jobId: job.id };
    }
    let persona;
    try {
      persona = valueOrCall(
        this.options.getBasePersona,
        valueOrCall(basePersona, null)
      );
    } catch (error) {
      const deferred = this.store.deferJob({
        job,
        owner: this.owner,
        generation: this.generation,
        reason: `Base Persona unavailable: ${String(error?.message || error)}`
      });
      return {
        status: 'retry',
        modelCalls: 0,
        committed: false,
        jobId: job.id,
        retry: deferred.status
      };
    }
    if (!persona || typeof persona !== 'object') {
      const deferred = this.store.deferJob({
        job,
        owner: this.owner,
        generation: this.generation,
        reason: 'Base Persona unavailable'
      });
      return {
        status: 'retry',
        modelCalls: 0,
        committed: false,
        jobId: job.id,
        retry: deferred.status
      };
    }
    const basePersonaHash = hashBasePersona(persona);
    const requestedMode = String(valueOrCall(this.options.getMode, mode) || 'review');
    const selectedMode = requestedMode === 'bounded_auto' ? 'bounded_auto' : 'review';
    const profileRevision = Number(
      valueOrCall(this.options.getExpectedProfileRevision, expectedProfileRevision)
        ?? this.#headRevision(job.accountId)
    );
    const budget = this.store.consumeModelCallBudget({
      owner: this.owner,
      generation: this.generation,
      maxCallsPerDay: this.limits.maxCallsPerDay
    });
    if (!budget.allowed) {
      const deferred = this.store.deferJob({
        job,
        owner: this.owner,
        generation: this.generation,
        reason: `reflection budget: ${budget.reason}`
      });
      return {
        status: 'budget',
        modelCalls: 0,
        committed: false,
        jobId: job.id,
        retry: deferred.status
      };
    }
    let raw;
    try {
      raw = await this.#callReflector({ job, persona, basePersonaHash, selectedMode, signal });
    } catch (error) {
      if (error?.code === 'REFLECTION_STOPPED' || signal.aborted || !this.active) {
        return { status: 'stopped', modelCalls: 1, committed: false, jobId: job.id };
      }
      const failed = this.store.failJob({
        job,
        owner: this.owner,
        generation: this.generation,
        error
      });
      return {
        status: 'retry',
        modelCalls: 1,
        committed: false,
        jobId: job.id,
        retry: failed.status
      };
    }
    if (signal.aborted || !this.active) {
      return { status: 'stopped', modelCalls: 1, committed: false, jobId: job.id };
    }
    let output;
    try {
      output = validateReflectionOutput(raw, {
        evidence: job.evidence,
        limits: this.limits
      });
    } catch (error) {
      const invalid = this.store.invalidateJob({
        job,
        owner: this.owner,
        generation: this.generation,
        error,
        status: 'invalid'
      });
      return {
        status: invalid.accepted ? 'invalid' : 'late-result',
        modelCalls: 1,
        committed: false,
        jobId: job.id,
        errorCode: error?.code || 'REFLECTION_INVALID_OUTPUT'
      };
    }
    let latestPersona = persona;
    try {
      latestPersona = valueOrCall(this.options.getBasePersona, persona);
    } catch (error) {
      this.store.invalidateJob({
        job,
        owner: this.owner,
        generation: this.generation,
        status: 'stale',
        error: Object.assign(new Error(`Base Persona unavailable after reflection: ${
          String(error?.message || error)
        }`), { code: 'REFLECTION_BASE_PERSONA_CHANGED' })
      });
      return {
        status: 'stale',
        modelCalls: 1,
        committed: false,
        jobId: job.id,
        errorCode: 'REFLECTION_BASE_PERSONA_CHANGED'
      };
    }
    if (latestPersona && hashBasePersona(latestPersona) !== basePersonaHash) {
      this.store.invalidateJob({
        job,
        owner: this.owner,
        generation: this.generation,
        status: 'stale',
        error: Object.assign(new Error('Base Persona changed during reflection'), {
          code: 'REFLECTION_BASE_PERSONA_CHANGED'
        })
      });
      return {
        status: 'stale',
        modelCalls: 1,
        committed: false,
        jobId: job.id,
        errorCode: 'REFLECTION_BASE_PERSONA_CHANGED'
      };
    }
    const committed = this.store.commitReflectionResult({
      job,
      owner: this.owner,
      generation: this.generation,
      output,
      mode: selectedMode,
      basePersonaHash,
      expectedProfileRevision: profileRevision,
      notebook
    });
    if (committed.accepted !== true) {
      return {
        status: committed.reason === 'late-result' ? 'late-result' : committed.reason || 'stale',
        modelCalls: 1,
        committed: false,
        jobId: job.id
      };
    }
    return {
      status: committed.status === 'noop' || committed.jobStatus === 'noop' ? 'noop' : 'completed',
      modelCalls: 1,
      committed: true,
      jobId: job.id,
      batchId: committed.batchId || '',
      jobStatus: committed.jobStatus || 'noop',
      profileRevision: committed.profileRevision
    };
  }

  async #callReflector({ job, persona, basePersonaHash, selectedMode, signal }) {
    const timeoutMs = Math.max(1, Number(this.limits.reflectionTimeoutMs)
      || Number(this.limits.timeoutMs)
      || 30000);
    const controller = new AbortController();
    const combined = typeof AbortSignal?.any === 'function'
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    if (signal.aborted) throw stoppedError(signal.reason?.message || 'stopped');
    const timeout = setTimeout(() => {
      controller.abort(Object.assign(new Error('reflection timeout'), {
        code: 'REFLECTION_TIMEOUT'
      }));
    }, timeoutMs);
    try {
      const prompt = reflectionPrompt(job, this.limits);
      if (prompt.length > this.limits.maxModelInputChars) {
        throw new ReflectionError('REFLECTION_LIMIT_EXCEEDED', 'reflection prompt exceeds input budget');
      }
      return await Promise.race([
        Promise.resolve().then(() => this.reflector({
          job,
          evidence: job.evidence,
          basePersona: persona,
          basePersonaHash,
          mode: selectedMode,
          prompt,
          signal: combined
        })),
        new Promise((_, reject) => {
          combined.addEventListener('abort', () => {
            reject(combined.reason || stoppedError('reflection aborted'));
          }, { once: true });
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  #headRevision(accountId) {
    const context = this.store.getLearnedSelfContext({
      accountId,
      basePersonaHash: '0'.repeat(64)
    });
    return Number(context.revision) || 0;
  }

  #schedule(delayMs) {
    if (!this.active) return;
    const callback = () => {
      this.timer = null;
      if (!this.active) return;
      this.runOnce()
        .catch(() => {})
        .finally(() => {
          if (this.active) this.#schedule(this.options.pollIntervalMs);
        });
    };
    if (this.services?.resources?.setTimer) {
      this.timer = this.services.resources.setTimer(callback, delayMs);
    } else {
      this.timer = setTimeout(callback, delayMs);
      this.timer.unref?.();
    }
  }

  #clearTimer() {
    if (this.timer == null) return;
    if (this.services?.resources?.clearTimer) this.services.resources.clearTimer(this.timer);
    else clearTimeout(this.timer);
    this.timer = null;
  }
}
