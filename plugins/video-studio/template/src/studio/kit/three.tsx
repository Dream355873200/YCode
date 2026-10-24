import React from "react";
import { useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useTheme } from "../theme";

// 3D 舞台：@remotion/three 的 ThreeCanvas 封装（尺寸取画面、默认相机与灯光）。
// 3D 物体的旋转/位移必须从 useCurrentFrame() 推导，禁止 useFrame/requestAnimationFrame。
//
//   const frame = useCurrentFrame();
//   <ThreeStage>
//     <mesh rotation={[0, frame * 0.02, 0]}><torusKnotGeometry args={[1, 0.3, 128, 32]} /><meshStandardMaterial color="#7C5CFF" /></mesh>
//   </ThreeStage>

export const ThreeStage: React.FC<{
  children?: React.ReactNode;
  camera?: { position?: [number, number, number]; fov?: number };
  /** studio：三点布光；soft：柔和环境光；none：自己布光 */
  lights?: "studio" | "soft" | "none";
  background?: string;
}> = ({ children, camera, lights = "studio", background }) => {
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  return (
    <ThreeCanvas
      width={width}
      height={height}
      camera={{ position: camera?.position ?? [0, 0, 6], fov: camera?.fov ?? 40 }}
      style={{ background: background ?? "transparent" }}
    >
      {lights === "studio" ? (
        <>
          <ambientLight intensity={0.45} />
          <directionalLight position={[5, 6, 5]} intensity={1.4} />
          <pointLight position={[-6, -2, 3]} intensity={40} color={theme.palette.secondary} />
          <pointLight position={[4, -4, -2]} intensity={25} color={theme.palette.primary} />
        </>
      ) : lights === "soft" ? (
        <>
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 4, 5]} intensity={0.8} />
        </>
      ) : null}
      {children}
    </ThreeCanvas>
  );
};
