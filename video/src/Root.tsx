import { Composition, continueRender, delayRender } from "remotion";
import { Demo, DEMO_FRAMES, FPS } from "./Demo";
import { fontsLoaded } from "./lib/fonts";

const fonts = delayRender("fonts");
fontsLoaded.then(() => continueRender(fonts));

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Demo" component={Demo} durationInFrames={DEMO_FRAMES} fps={FPS} width={1920} height={1080} />
    </>
  );
};
