import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  AnalyticsError,
  errorMessageKey,
  formatAnalyticsError,
  offsetToLineColumn,
  toAnalyticsError,
} from "./errors";
import { ANALYTICS_ERROR_CODES } from "../types";

// Echoes the key and the options, to check what formatAnalyticsError asks.
const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction;

describe("errors", () => {
  it("maps IPC payloads, errors and strings", () => {
    const fromPayload = toAnalyticsError(
      {
        code: "denied",
        message: "access to setting.key is prohibited",
        object: "setting.key",
      },
      { sql: "SELECT * FROM setting" }
    );
    expect(fromPayload).toBeInstanceOf(AnalyticsError);
    expect(fromPayload.code).toBe("denied");
    expect(fromPayload.object).toBe("setting.key");
    expect(fromPayload.sql).toBe("SELECT * FROM setting");

    expect(toAnalyticsError(new Error("boom")).code).toBe("internal");
    expect(toAnalyticsError("boom").message).toBe("boom");
    expect(toAnalyticsError({ code: "nope", message: "x" }).code).toBe(
      "internal"
    );
    expect(toAnalyticsError(fromPayload)).toBe(fromPayload);
  });

  it("computes 1-based lines and columns", () => {
    const sql = "SELECT 1\nFROM x\n  WHERE é = 2";
    expect(offsetToLineColumn(sql, 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineColumn(sql, 9)).toEqual({ line: 2, column: 1 });
    expect(offsetToLineColumn(sql, sql.indexOf("="))).toEqual({
      line: 3,
      column: 11,
    });
  });

  it("has a message key for every code", () => {
    for (const code of ANALYTICS_ERROR_CODES) {
      expect(errorMessageKey(code)).toBe(`analytics.common.errors.${code}`);
    }
  });

  it("formats syntax errors with their position", () => {
    const error = new AnalyticsError(
      { code: "syntax", message: 'near "FORM"', offset: 9 },
      { sql: "SELECT 1\nFORM x" }
    );
    expect(formatAnalyticsError(error, t)).toBe(
      'analytics.common.errors.syntax {"line":2,"column":1,"message":"near \\"FORM\\""}'
    );
    expect(
      formatAnalyticsError(
        new AnalyticsError({ code: "syntax", message: "x" }),
        t
      )
    ).toBe('analytics.common.errors.syntaxNoPosition {"message":"x"}');
  });

  it("formats denied, timeout and parameter errors", () => {
    expect(
      formatAnalyticsError(
        new AnalyticsError({ code: "denied", message: "x" }),
        t
      )
    ).toBe("analytics.common.errors.deniedNoObject");
    expect(
      formatAnalyticsError(
        new AnalyticsError(
          { code: "timeout", message: "x" },
          { timeoutMs: 20_000 }
        ),
        t
      )
    ).toBe('analytics.common.errors.timeout {"seconds":20}');
    expect(
      formatAnalyticsError(
        new AnalyticsError({
          code: "missing_param",
          message: "x",
          object: "season",
        }),
        t
      )
    ).toBe('analytics.common.errors.missing_param {"name":"season"}');
    expect(
      formatAnalyticsError(
        new AnalyticsError({ code: "busy", message: "x" }),
        t
      )
    ).toBe("analytics.common.errors.busy");
  });
});
