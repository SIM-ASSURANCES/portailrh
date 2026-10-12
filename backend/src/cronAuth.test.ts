import { describe, expect, it } from "vitest";

import { secretCronValide } from "./cronAuth";

describe("secretCronValide", () => {
  it("accepte exactement « Bearer <secret> »", () => {
    expect(secretCronValide("Bearer s3cr3t-long", "s3cr3t-long")).toBe(true);
  });
  it("refuse sans secret configuré, même avec un en-tête", () => {
    expect(secretCronValide("Bearer ", "")).toBe(false);
    expect(secretCronValide("Bearer undefined", undefined)).toBe(false);
    expect(secretCronValide("Bearer null", null)).toBe(false);
  });
  it("refuse sans en-tête, avec un mauvais secret, une autre longueur, un autre schéma ou des espaces", () => {
    expect(secretCronValide(null, "s3cr3t-long")).toBe(false);
    expect(secretCronValide("", "s3cr3t-long")).toBe(false);
    expect(secretCronValide("Bearer s3cr3t-lonG", "s3cr3t-long")).toBe(false);
    expect(secretCronValide("Bearer s3cr3t", "s3cr3t-long")).toBe(false);
    expect(secretCronValide("Bearer s3cr3t-long ", "s3cr3t-long")).toBe(false);
    expect(secretCronValide("Basic s3cr3t-long", "s3cr3t-long")).toBe(false);
    expect(secretCronValide("s3cr3t-long", "s3cr3t-long")).toBe(false);
    expect(secretCronValide("bearer s3cr3t-long", "s3cr3t-long")).toBe(false);
  });
});
