import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// IBM Plex Mono, the face of the app and the website
export const FONT = "Plex Mono";
export const fontsLoaded = Promise.all(
  ["400", "500", "600", "700"].map((weight) =>
    loadFont({ family: FONT, url: staticFile(`fonts/plex-mono-${weight}.woff2`), weight }),
  ),
);
