const ID_RE = /^[a-z][a-z0-9._-]{0,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const EFFECTS = new Set(['read', 'local-write', 'external-write', 'control']);
const RESERVED_TOOLS = new Set(['finish']);
const TERMINAL_OWNER = 'runtime-control';
const LEGACY_OWNER = 'legacy-tools';

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function assertNonEmptyString(value, path, max = 200) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a non-empty string');
  if (value.length > max) fail(path, `must be at most ${max} characters`);
  return value.trim();
}

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value;
}

function validateParameters(parameters, path) {
  assertObject(parameters, path);
  if (parameters.type !== 'object') fail(`${path}.type`, 'must be object');
  if (parameters.properties !== undefined) assertObject(parameters.properties, `${path}.properties`);
  if (parameters.required !== undefined) {
    if (!Array.isArray(parameters.required)
      || parameters.required.some((item) => typeof item !== 'string')) {
      fail(`${path}.required`, 'must be an array of strings');
    }
  }
  if (parameters.additionalProperties !== undefined
    && typeof parameters.additionalProperties !== 'boolean'
    && (typeof parameters.additionalProperties !== 'object'
      || parameters.additionalProperties === null
      || Array.isArray(parameters.additionalProperties))) {
    fail(`${path}.additionalProperties`, 'must be boolean or schema object');
  }
  return parameters;
}

export function validateToolRegistration(tool, pluginId = '') {
  assertObject(tool, 'tool');
  const name = assertNonEmptyString(tool.name, 'tool.name', 80);
  if (!/^[a-z][a-z0-9_.-]*$/.test(name)) fail('tool.name', 'must be a stable tool identifier');
  const description = assertNonEmptyString(tool.description, `tool(${name}).description`, 20000);
  const parameters = validateParameters(tool.parameters, `tool(${name}).parameters`);
  if (typeof tool.execute !== 'function') fail(`tool(${name}).execute`, 'must be a function');

  const ownerPluginId = assertNonEmptyString(
    tool.ownerPluginId,
    `tool(${name}).ownerPluginId`,
    80
  );
  if (pluginId && ownerPluginId !== pluginId) {
    fail(`tool(${name}).ownerPluginId`, `must equal plugin id ${pluginId}`);
  }
  if (!EFFECTS.has(tool.effect)) fail(`tool(${name}).effect`, `must be one of ${[...EFFECTS].join(', ')}`);
  if (typeof tool.parallelSafe !== 'boolean') fail(`tool(${name}).parallelSafe`, 'must be boolean');
  if (typeof tool.terminal !== 'boolean') fail(`tool(${name}).terminal`, 'must be boolean');
  if (tool.order !== undefined && (!Number.isInteger(tool.order) || tool.order < 0)) {
    fail(`tool(${name}).order`, 'must be a non-negative integer when provided');
  }
  if (tool.terminal && ownerPluginId !== TERMINAL_OWNER) {
    fail(`tool(${name}).terminal`, `only ${TERMINAL_OWNER} may register terminal tools`);
  }
  if (name === 'finish' && ![TERMINAL_OWNER, LEGACY_OWNER].includes(ownerPluginId)) {
    fail(`tool(${name})`, `reserved tool name may only be owned by ${TERMINAL_OWNER} or ${LEGACY_OWNER}`);
  }
  if (tool.availability !== undefined && typeof tool.availability !== 'function') {
    fail(`tool(${name}).availability`, 'must be a function when provided');
  }

  return {
    ...tool,
    name,
    description,
    parameters,
    ownerPluginId,
    effect: tool.effect,
    parallelSafe: tool.parallelSafe,
    terminal: tool.terminal
  };
}

export function validateContextProvider(provider, pluginId = '') {
  assertObject(provider, 'contextProvider');
  const id = assertNonEmptyString(provider.id, 'contextProvider.id', 120);
  if (!ID_RE.test(id)) fail('contextProvider.id', 'must be a stable identifier');
  if (typeof provider.provide !== 'function') fail(`contextProvider(${id}).provide`, 'must be a function');
  const ownerPluginId = assertNonEmptyString(
    provider.ownerPluginId,
    `contextProvider(${id}).ownerPluginId`,
    80
  );
  if (pluginId && ownerPluginId !== pluginId) {
    fail(`contextProvider(${id}).ownerPluginId`, `must equal plugin id ${pluginId}`);
  }
  return { ...provider, id, ownerPluginId };
}

export function validateSessionObserver(observer, pluginId = '') {
  assertObject(observer, 'sessionObserver');
  const id = assertNonEmptyString(observer.id, 'sessionObserver.id', 120);
  if (!ID_RE.test(id)) fail('sessionObserver.id', 'must be a stable identifier');
  if (typeof observer.observe !== 'function') fail(`sessionObserver(${id}).observe`, 'must be a function');
  const ownerPluginId = assertNonEmptyString(
    observer.ownerPluginId,
    `sessionObserver(${id}).ownerPluginId`,
    80
  );
  if (pluginId && ownerPluginId !== pluginId) {
    fail(`sessionObserver(${id}).ownerPluginId`, `must equal plugin id ${pluginId}`);
  }
  return { ...observer, id, ownerPluginId };
}

export function validatePluginDefinition(plugin) {
  assertObject(plugin, 'plugin');
  const id = assertNonEmptyString(plugin.id, 'plugin.id', 80);
  if (!ID_RE.test(id)) fail('plugin.id', 'must start with a lowercase letter and use [a-z0-9._-]');
  const name = assertNonEmptyString(plugin.name, 'plugin.name', 120);
  const version = assertNonEmptyString(plugin.version, 'plugin.version', 80);
  if (!VERSION_RE.test(version)) fail('plugin.version', 'must use semantic version format');
  if (!Number.isInteger(plugin.apiVersion) || plugin.apiVersion < 1) {
    fail('plugin.apiVersion', 'must be a positive integer');
  }
  if (typeof plugin.declare !== 'function') fail('plugin.declare', 'must be a function');
  if (plugin.required !== undefined && typeof plugin.required !== 'boolean') {
    fail('plugin.required', 'must be boolean');
  }
  if (plugin.enabled !== undefined && typeof plugin.enabled !== 'boolean') {
    fail('plugin.enabled', 'must be boolean');
  }
  if (plugin.isEnabled !== undefined && typeof plugin.isEnabled !== 'function') {
    fail('plugin.isEnabled', 'must be a function when provided');
  }
  if (plugin.start !== undefined && typeof plugin.start !== 'function') {
    fail('plugin.start', 'must be a function when provided');
  }
  if (plugin.stop !== undefined && typeof plugin.stop !== 'function') {
    fail('plugin.stop', 'must be a function when provided');
  }
  return {
    ...plugin,
    id,
    name,
    version,
    required: plugin.required === true,
    enabled: plugin.enabled !== false
  };
}

export function isReservedToolName(name) {
  return RESERVED_TOOLS.has(String(name || ''));
}

export const PLUGIN_EFFECTS = Object.freeze([...EFFECTS]);
export const RESERVED_TOOL_NAMES = Object.freeze([...RESERVED_TOOLS]);
export const TERMINAL_PLUGIN_ID = TERMINAL_OWNER;
