import { FONT } from "./fonts";

/** Branding palette (branding/README.md): dark tile, light glyph, lime accent. */
export const C = {
  bg: "#100d0d",
  bg2: "#181414",
  panel: "#1c1818",
  line: "#2d2828",
  track: "#231f1f",
  text: "#f1ecec",
  dim: "#9b9393",
  faint: "#5e5757",
  lime: "#f6fa89",
  limeDeep: "#c9d22e",
  red: "#ff6b6b",
};

export const font = (size: number, weight = 500) => ({
  fontFamily: `"${FONT}", ui-monospace, monospace`,
  fontSize: size,
  fontWeight: weight,
});

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
