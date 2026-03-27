export function buildGraphNamespace(tenant: string): string {
  return `cg_${sanitize(tenant)}`;
}

export function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}
