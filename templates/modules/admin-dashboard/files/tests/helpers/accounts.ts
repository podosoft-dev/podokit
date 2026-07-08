export type Account = { name: string; email: string; password: string };
export const ADMIN = { name: "Admin", email: "admin@example.com", password: "Podokit3e-Str0ng!pw" };
export const USER = { name: "Normal User", email: "user@example.com", password: "Podokit3e-Str0ng!pw" };
export const adminState = "playwright/.auth/admin.json";
export const userState = "playwright/.auth/user.json";
export const anonState = { cookies: [], origins: [] } as const;
