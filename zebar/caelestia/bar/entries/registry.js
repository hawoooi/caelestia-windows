const factories = new Map();

export function register(type, factory) {
  if (factories.has(type)) throw new Error(`entry type already registered: ${type}`);
  factories.set(type, factory);
}

export function create(type, ctx) {
  const factory = factories.get(type);
  if (!factory) throw new Error(`unknown entry type: ${type}`);
  return factory(ctx);
}

export function knownTypes() {
  return [...factories.keys()];
}

// Test-only: reset between cases.
export function clear() {
  factories.clear();
}
