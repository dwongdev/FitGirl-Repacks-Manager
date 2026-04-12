import PocketBase from "pocketbase";

const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || "";

export const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);

// Use default LocalAuthStore which automatically persists to localStorage in Electron/Browser environments

