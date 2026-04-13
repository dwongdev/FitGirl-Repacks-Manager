import PocketBase from "pocketbase";

const pbUrl =
  "http://pocketbase-z0s00ww840s0g0sow8s8kk84.93.127.186.247.sslip.io";

export const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);

// Use default LocalAuthStore which automatically persists to localStorage in Electron/Browser environments
