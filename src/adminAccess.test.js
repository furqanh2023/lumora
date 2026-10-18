import { ADMIN_EMAIL, ADMIN_UID, isAdminAccount } from "./adminAccess";

describe("Lumora admin identity gate", () => {
  test("accepts the pinned account regardless of email verification status", () => {
    expect(isAdminAccount({ uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: false })).toBe(true);
    expect(isAdminAccount({ uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true })).toBe(true);
  });

  test("rejects the same email on any other UID", () => {
    expect(isAdminAccount({ uid: "different-uid", email: ADMIN_EMAIL, emailVerified: true })).toBe(false);
  });

  test("rejects the same UID if the email does not exactly match", () => {
    expect(isAdminAccount({ uid: ADMIN_UID, email: "other@example.com", emailVerified: true })).toBe(false);
    expect(isAdminAccount({ uid: ADMIN_UID, email: "Furqan@gmail.com", emailVerified: true })).toBe(false);
  });

  test("rejects missing users", () => {
    expect(isAdminAccount(null)).toBe(false);
    expect(isAdminAccount({ email: ADMIN_EMAIL })).toBe(false);
  });
});
