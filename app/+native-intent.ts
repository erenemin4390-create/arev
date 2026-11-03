import type { NativeIntent } from "expo-router";

export const redirectSystemPath: NativeIntent["redirectSystemPath"] = ({ path }) => {
  try {
    const decoded = decodeURIComponent(path);
    const isShareHost = decoded.includes("expo-sharing") || decoded.includes("share");
    if (isShareHost) return "/(tabs)";
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
  } catch {
    return "/(tabs)";
  }
};
