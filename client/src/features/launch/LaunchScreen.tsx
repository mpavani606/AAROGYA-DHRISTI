import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { Group, PerspectiveCamera } from "three";
import { MathUtils } from "three";
import { SimulationBanner } from "../../components/SimulationBanner";

const SESSION_KEY = "aarogya-launch-seen";
const OPEN_DURATION = 1800;

type LaunchScreenProps = {
  onComplete: () => void;
};

function EyeOrb({ opening }: { opening: boolean }) {
  const leftShell = useRef<Group>(null);
  const rightShell = useRef<Group>(null);
  const iris = useRef<Group>(null);
  const { camera, pointer } = useThree();
  const startedAt = useRef<number | null>(null);

  useFrame(({ clock }) => {
    if (opening && startedAt.current === null) startedAt.current = clock.elapsedTime;
    const elapsed = startedAt.current === null ? 0 : (clock.elapsedTime - startedAt.current) * 1000;
    const progress = opening ? MathUtils.smoothstep(Math.min(elapsed / OPEN_DURATION, 1), 0, 1) : 0;
    const idle = Math.sin(clock.elapsedTime * 1.2) * 0.08;

    if (leftShell.current && rightShell.current && iris.current) {
      leftShell.current.position.x = -progress * 1.25;
      rightShell.current.position.x = progress * 1.25;
      iris.current.scale.setScalar(1 + progress * 0.55);
      iris.current.position.x = MathUtils.lerp(iris.current.position.x, pointer.x * 0.42, 0.08);
      iris.current.position.y = MathUtils.lerp(iris.current.position.y, pointer.y * 0.32 + idle, 0.08);
      iris.current.rotation.z += 0.006;
    }

    const perspectiveCamera = camera as PerspectiveCamera;
    perspectiveCamera.position.z = MathUtils.lerp(perspectiveCamera.position.z, 6 - progress * 1.65, 0.08);
    perspectiveCamera.lookAt(0, 0, 0);
  });

  return (
    <group rotation={[0.08, -0.1, 0]}>
      <group ref={leftShell}>
        <mesh>
          <sphereGeometry args={[1.45, 24, 16, 0, Math.PI, 0, Math.PI]} />
          <meshStandardMaterial color="#d989a7" roughness={0.28} metalness={0.12} />
        </mesh>
      </group>
      <group ref={rightShell}>
        <mesh>
          <sphereGeometry args={[1.45, 24, 16, Math.PI, Math.PI, 0, Math.PI]} />
          <meshStandardMaterial color="#e8a0b8" roughness={0.28} metalness={0.12} />
        </mesh>
      </group>
      <group ref={iris}>
        <mesh>
          <sphereGeometry args={[0.74, 20, 12]} />
          <meshStandardMaterial color="#f8dce7" emissive="#e8a0b8" emissiveIntensity={1.2} />
        </mesh>
        <mesh position={[0, 0, 0.62]}>
          <sphereGeometry args={[0.34, 16, 10]} />
          <meshStandardMaterial color="#805363" emissive="#f3d5e0" emissiveIntensity={0.2} />
        </mesh>
        <mesh position={[0.12, 0.16, 0.9]}>
          <sphereGeometry args={[0.08, 10, 8]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
    </group>
  );
}

function FloatingParticles({ opening }: { opening: boolean }) {
  const points = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!points.current) return;
    points.current.rotation.y = clock.elapsedTime * 0.035;
    points.current.position.z = opening ? Math.min((clock.elapsedTime % 2) * 0.8, 1.5) : 0;
    points.current.scale.setScalar(opening ? 1.2 : 1);
  });

  return (
    <group ref={points}>
      {Array.from({ length: 18 }, (_, index) => {
        const angle = index * 2.4;
        const radius = 2.1 + (index % 3) * 0.35;
        return (
          <mesh key={index} position={[Math.cos(angle) * radius, Math.sin(angle * 1.3) * 1.5, (index % 4) - 1.5]}>
            <sphereGeometry args={[0.025 + (index % 2) * 0.018, 6, 6]} />
            <meshBasicMaterial color={index % 2 ? "#e8a0b8" : "#f8dce7"} transparent opacity={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

function LaunchScene({ opening }: { opening: boolean }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[2, 2, 4]} color="#f3d5e0" intensity={8} distance={10} />
      <EyeOrb opening={opening} />
      <FloatingParticles opening={opening} />
    </>
  );
}

function WebGLFallback({ opening }: { opening: boolean }) {
  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center"
      animate={{ opacity: opening ? 0 : 1 }}
      transition={{ duration: 0.55, delay: opening ? 1.15 : 0 }}
    >
      <motion.div
        aria-hidden="true"
        className="relative flex h-56 w-56 items-center justify-center rounded-full border-8 border-pink-200/70 bg-pink-200 shadow-[0_0_60px_rgba(217,137,167,0.25)]"
        animate={{ scale: opening ? 1.35 : [1, 1.04, 1] }}
        transition={{ duration: opening ? 1.8 : 2.4, repeat: opening ? 0 : Infinity }}
      >
        <span className="h-28 w-28 rounded-full bg-pink-100 shadow-[0_0_30px_#f3d5e0]">
          <span className="mx-auto block h-12 w-12 translate-y-8 rounded-full bg-pink-400" />
        </span>
      </motion.div>
    </motion.div>
  );
}

export default function LaunchScreen({ onComplete }: LaunchScreenProps) {
  const [opening, setOpening] = useState(false);
  const [webGLAvailable, setWebGLAvailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    setWebGLAvailable(Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);
    const onVisibilityChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!opening) return;
    const timer = window.setTimeout(() => {
      sessionStorage.setItem(SESSION_KEY, "true");
      onComplete();
    }, OPEN_DURATION);
    return () => window.clearTimeout(timer);
  }, [onComplete, opening]);

  const open = () => {
    if (!opening) setOpening(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };

  return (
    <div className="relative h-screen overflow-hidden bg-[radial-gradient(circle_at_center,_#ffffff_0%,_#fceaf1_52%,_#fff5f8_100%)] text-slate-900">
      <SimulationBanner />
      <main className="relative h-full pt-12">
        {webGLAvailable && !reducedMotion ? (
          <Canvas
            dpr={[1, 1.5]}
            frameloop={visible ? "always" : "never"}
            gl={{ antialias: false, powerPreference: "low-power" }}
            camera={{ position: [0, 0, 6], fov: 45 }}
          >
            <LaunchScene opening={opening} />
          </Canvas>
        ) : (
          <WebGLFallback opening={opening} />
        )}
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4 text-center">
          <div className="rounded-3xl border border-white/80 bg-white/85 px-6 py-4 shadow-xl backdrop-blur-sm sm:px-10 sm:py-6">
            <p className="font-sans text-3xl font-extrabold tracking-tight text-emerald-800 sm:text-5xl">Aarogya Drishti</p>
            <p className="mt-2 font-sans text-lg font-semibold text-teal-800">ఆరోగ్య దృష్టి</p>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-10 text-center">
          <motion.p
            className="font-sans text-base font-bold text-emerald-800"
            animate={{ opacity: opening ? 0 : [0.65, 1, 0.65] }}
            transition={{ duration: 2, repeat: opening ? 0 : Infinity }}
          >
            Tap to begin / తాకండి / छुएं
          </motion.p>
        </div>
        <button
          type="button"
          aria-label="Open Aarogya Drishti"
          className="absolute inset-0 z-0 cursor-pointer bg-transparent focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-pink-200"
          onClick={open}
          onKeyDown={handleKeyDown}
        />
      </main>
      <button
        type="button"
        className="absolute bottom-5 right-5 z-10 rounded-xl border border-pink-200 bg-white/80 px-5 font-semibold text-slate-700 backdrop-blur"
        onClick={() => {
          sessionStorage.setItem(SESSION_KEY, "true");
          onComplete();
        }}
      >
        Skip
      </button>
    </div>
  );
}

export { SESSION_KEY };
