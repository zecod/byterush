/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);
// REMOTION_BROWSER=/path/to/chrome-headless-shell to render with a browser that is already installed
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? null);

// The videos show the app's own components (imported from ../src); they must share this
// project's single copy of React and of the icon set.
const local = (name: string) => path.resolve(process.cwd(), "node_modules", name);
Config.overrideRspackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...((config.resolve?.alias as Record<string, string>) ?? {}),
      react: local("react"),
      "react-dom": local("react-dom"),
      "@hugeicons/react": local("@hugeicons/react"),
      "@hugeicons/core-free-icons": local("@hugeicons/core-free-icons"),
      "@tauri-apps/api": path.resolve(process.cwd(), "src/lib/no-tauri"),
    },
  },
}));
