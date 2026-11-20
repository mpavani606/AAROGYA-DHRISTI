import { describe, expect, it } from "@jest/globals";
import { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } from "../dist/services/tokens.js";

describe("JWT tokens", () => {
  it("signs and verifies access and refresh tokens with distinct types", () => {
    const access = verifyAccessToken(signAccessToken({ sub: "user-1", role: "patient" }));
    const refresh = verifyRefreshToken(signRefreshToken({ sub: "user-1", role: "patient" }));
    expect(access).toMatchObject({ sub: "user-1", role: "patient", type: "access" });
    expect(refresh).toMatchObject({ sub: "user-1", role: "patient", type: "refresh" });
  });
});
