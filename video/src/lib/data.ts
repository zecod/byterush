import type { Telemetry } from "./telemetry";
import raceFast from "../../public/telemetry/race-fast.json";
import raceSlow from "../../public/telemetry/race-slow.json";
import demo from "../../public/telemetry/demo.json";
import handover from "../../public/telemetry/handover.json";

/** The race: the same file, one connection (how browsers download) and Byterush's 32. */
export const RACE_FAST = raceFast as unknown as Telemetry;
export const RACE_SLOW = raceSlow as unknown as Telemetry;
/** The demo's main download (paused and resumed on the way) and the one handed over by the browser. */
export const DEMO = demo as unknown as Telemetry;
export const HANDOVER = handover as unknown as Telemetry;

/** Where and when the recordings were made, shown in the videos' footnotes. */
export const MEASURED = "measured 23 Oct 2026";
