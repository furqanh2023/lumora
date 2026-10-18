import { saveUserProfile } from "./Components/userProfile";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

jest.mock("firebase/app", () => ({ initializeApp: () => ({ name: "test-app" }) }));
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: null }) }));
jest.mock("firebase/firestore", () => ({
  getFirestore: () => ({ name: "test-db" }),
  doc: jest.fn(() => "profile-reference"),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
  setDoc: jest.fn(() => Promise.resolve()),
  writeBatch: jest.fn(() => ({ set: jest.fn(), commit: jest.fn(() => Promise.resolve()) })),
  serverTimestamp: jest.fn(() => "mock-timestamp"),
  collection: jest.fn(() => ({})),
  onSnapshot: jest.fn(() => () => {}),
  query: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
}));

describe("saveUserProfile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    doc.mockReturnValue("profile-reference");
    getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    setDoc.mockResolvedValue(undefined);
    serverTimestamp.mockReturnValue("mock-timestamp");
  });

  test("creates a user profile under the signed-in user's UID", async () => {
    const user = {
      uid: "user-123",
      displayName: "Lumora Member",
      email: "member@example.com",
      photoURL: null,
      providerData: [{ providerId: "password" }],
    };

    await saveUserProfile(user);

    expect(doc).toHaveBeenCalledWith(expect.anything(), "users", "user-123");
    expect(getDoc).toHaveBeenCalledWith("profile-reference");
    expect(setDoc).toHaveBeenCalledWith(
      "profile-reference",
      expect.objectContaining({
        uid: "user-123",
        displayName: "Lumora Member",
        email: "member@example.com",
        provider: "password",
        createdAt: "mock-timestamp",
        updatedAt: "mock-timestamp",
      }),
      { merge: true }
    );
  });

  test("rejects calls without a signed-in user", async () => {
    await expect(saveUserProfile(null)).rejects.toThrow(
      "A signed-in user is required to save a profile."
    );
    expect(setDoc).not.toHaveBeenCalled();
  });
});
