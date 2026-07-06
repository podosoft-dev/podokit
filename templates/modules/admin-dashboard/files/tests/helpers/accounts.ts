export type Account = { name: string; email: string; password: string };
export const ADMIN = { name: "Admin", email: "admin@example.com", password: "password123" };
export const USER = { name: "Normal User", email: "user@example.com", password: "password123" };
export const adminState = "playwright/.auth/admin.json";
export const userState = "playwright/.auth/user.json";
export const anonState = { cookies: [], origins: [] } as const;
