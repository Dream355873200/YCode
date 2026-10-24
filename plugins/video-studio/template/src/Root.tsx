import React from "react";
import { Composition } from "remotion";
import { Film, SceneComposition, project } from "./studio/film";
import { compIdOf } from "./studio/manifest";

// 模板固定（agent 不改）：注册整片 Film 与每个场景的单场景合成（id = 场景 id 净化后）。

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Film"
      component={Film}
      durationInFrames={project.durationInFrames}
      fps={project.fps}
      width={project.width}
      height={project.height}
    />
    {project.scenes.map((s) => (
      <Composition
        key={s.id}
        id={compIdOf(s.id)}
        component={SceneComposition as unknown as React.FC<Record<string, unknown>>}
        defaultProps={{ sceneId: s.id }}
        durationInFrames={s.durationInFrames}
        fps={project.fps}
        width={project.width}
        height={project.height}
      />
    ))}
  </>
);
