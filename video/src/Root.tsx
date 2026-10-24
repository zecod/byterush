import { Composition, continueRender, delayRender } from "remotion";
import { Demo, demoFrames, FPS } from "./Demo";
import { fontsLoaded } from "./lib/fonts";
import { SINTEL, TEN_GB_FSN, TEN_GB_HEL } from "./lib/takes";

const fonts = delayRender("fonts");
fontsLoaded.then(() => continueRender(fonts));

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Demo" component={Demo} defaultProps={{ race: SINTEL }} durationInFrames={demoFrames(SINTEL)} fps={FPS} width={1920} height={1080} />
      <Composition
        id="Demo10GBHelsinki"
        component={Demo}
        defaultProps={{ race: TEN_GB_HEL }}
        durationInFrames={demoFrames(TEN_GB_HEL)}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Demo10GBFalkenstein"
        component={Demo}
        defaultProps={{ race: TEN_GB_FSN }}
        durationInFrames={demoFrames(TEN_GB_FSN)}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
