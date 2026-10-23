import React from "react";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { AppShowcase } from "./AppShowcase";
import { CrashProof, ExpiredLink, Takeover, Thousands } from "./Features";
import { LogoReveal } from "./LogoReveal";
import { OneLane } from "./OneLane";
import { Outro } from "./Outro";
import { Race } from "./Race";
import { Split } from "./Split";

/** Scene lengths in seconds; the composition's duration is computed from these in Root.tsx. */
export const INTRO = { oneLane: 4, split: 5, logo: 3.4, race: 15, feature: 3.6, app: 6.4, outro: 4.4, overlap: 0.4 };
export const INTRO_TRANSITIONS = 9;

export const Intro: React.FC<{ manyFiles: number; manySeconds: number }> = ({ manyFiles, manySeconds }) => {
  const fps = 30;
  const t = linearTiming({ durationInFrames: INTRO.overlap * fps });
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="One lane" durationInFrames={INTRO.oneLane * fps}>
        <OneLane />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={t} />
      <TransitionSeries.Sequence name="Split" durationInFrames={INTRO.split * fps}>
        <Split />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={t} />
      <TransitionSeries.Sequence name="Logo" durationInFrames={INTRO.logo * fps}>
        <LogoReveal />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={wipe({ direction: "from-left" })} timing={t} />
      <TransitionSeries.Sequence name="Race" durationInFrames={INTRO.race * fps}>
        <Race />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={t} />
      <TransitionSeries.Sequence name="Crash-proof" durationInFrames={INTRO.feature * fps}>
        <CrashProof />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={t} />
      <TransitionSeries.Sequence name="Expired link" durationInFrames={INTRO.feature * fps}>
        <ExpiredLink />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={t} />
      <TransitionSeries.Sequence name="Takeover" durationInFrames={INTRO.feature * fps}>
        <Takeover />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={t} />
      <TransitionSeries.Sequence name="Thousands" durationInFrames={INTRO.feature * fps}>
        <Thousands files={manyFiles} seconds={manySeconds} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={t} />
      <TransitionSeries.Sequence name="App" durationInFrames={INTRO.app * fps}>
        <AppShowcase />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={t} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={INTRO.outro * fps}>
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
