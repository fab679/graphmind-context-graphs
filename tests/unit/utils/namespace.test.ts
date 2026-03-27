import { describe, it, expect } from "vitest";
import { buildGraphNamespace, sanitize } from "../../../src/utils/namespace.js";

describe("namespace utils", () => {
  describe("sanitize", () => {
    it("should convert to lowercase", () => {
      expect(sanitize("MyTenant")).toBe("mytenant");
    });

    it("should replace special characters with underscores", () => {
      expect(sanitize("my-tenant.name")).toBe("my_tenant_name");
    });

    it("should keep alphanumeric and underscores", () => {
      expect(sanitize("tenant_123")).toBe("tenant_123");
    });

    it("should handle spaces", () => {
      expect(sanitize("my tenant")).toBe("my_tenant");
    });
  });

  describe("buildGraphNamespace", () => {
    it("should prefix with cg_", () => {
      expect(buildGraphNamespace("acme")).toBe("cg_acme");
    });

    it("should sanitize the tenant name", () => {
      expect(buildGraphNamespace("Acme Corp")).toBe("cg_acme_corp");
    });
  });
});
