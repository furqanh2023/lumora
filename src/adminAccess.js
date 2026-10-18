/** Admin identity is pinned to a specific Firebase Auth UID and exact email.
 * The UID prevents another account that merely uses a similar display name from being treated as admin.
 */
export const ADMIN_EMAIL = "furqan@gmail.com";
export const ADMIN_UID = "BLILPJTQLwdfWmMILWqUzk4YHg12";

export function isAdminAccount(user) {
  return Boolean(user && user.uid === ADMIN_UID && user.email === ADMIN_EMAIL);
}
