import { Composition, continueRender, delayRender, Folder, Still } from "remotion";
import { fontsLoaded } from "./lib/fonts";
import { INTRO, INTRO_TRANSITIONS, Intro } from "./intro/Intro";
import { Race } from "./intro/Race";
import { WindowStill } from "./demo/WindowStill";
import { Screenshot } from "./demo/Screenshot";
import { Demo, demoFrames } from "./demo/Demo";

const fonts = delayRender("fonts");
fontsLoaded.then(() => continueRender(fonts));

const introSeconds =
  INTRO.oneLane + INTRO.split + INTRO.logo + INTRO.race + 4 * INTRO.feature + INTRO.app + INTRO.outro - INTRO_TRANSITIONS * INTRO.overlap;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Videos">
        <Composition
          id="Intro"
          component={Intro}
          durationInFrames={Math.round(introSeconds * 30)}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ manyFiles: 500, manySeconds: 0.36 }}
        />
        <Composition id="Demo" component={Demo} durationInFrames={demoFrames()} fps={30} width={1920} height={1080} />
      </Folder>
      <Folder name="Stills">
        <Still id="RacePoster" component={Race} width={1920} height={1080} />
        <Still id="Window" component={WindowStill} width={1240} height={780} />
        <Still id="Screenshot" component={Screenshot} width={1240} height={780} defaultProps={{ theme: "dark" as const, t: 3.2 }} />
      </Folder>
    </>
  );
};
