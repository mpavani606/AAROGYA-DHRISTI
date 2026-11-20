import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three";
import type { AssistantStatus } from "./useRealtimeAssistant";

function RobotEye({ level, status }: { level: number; status: AssistantStatus }) {
  const iris = useRef<Mesh>(null);
  const robot = useRef<Group>(null);
  useFrame(({ clock }) => {
    const active = status === "listening" || status === "speaking";
    if (robot.current) robot.current.position.y = Math.sin(clock.elapsedTime * 1.4) * 0.06;
    if (iris.current) {
      iris.current.scale.setScalar(1 + Math.min(level, 1) * 0.22 + (active ? 0.04 : 0));
      const material = iris.current.material;
      if ("emissiveIntensity" in material) material.emissiveIntensity = 0.7 + Math.min(level, 1) * 2.4 + (active ? 0.2 : 0);
    }
  });
  return <group ref={robot}>
    <mesh>
      <sphereGeometry args={[0.78, 20, 14]} />
      <meshStandardMaterial color="#0f766e" roughness={0.28} metalness={0.18} />
    </mesh>
    <mesh ref={iris} position={[0, 0.02, 0.61]}>
      <sphereGeometry args={[0.42, 18, 12]} />
      <meshStandardMaterial color="#5eead4" emissive="#14b8a6" emissiveIntensity={1} />
    </mesh>
    <mesh position={[0, 0.02, 0.94]}>
      <sphereGeometry args={[0.17, 12, 8]} />
      <meshStandardMaterial color="#042f2e" emissive="#ccfbf1" emissiveIntensity={0.3} />
    </mesh>
    <mesh position={[0.18, 0.2, 1.03]}>
      <sphereGeometry args={[0.055, 8, 6]} />
      <meshBasicMaterial color="white" />
    </mesh>
    <mesh position={[0, -0.5, 0.51]} rotation={[0, 0, Math.PI]}>
      <torusGeometry args={[0.16, 0.025, 6, 14, Math.PI]} />
      <meshStandardMaterial color="#99f6e4" emissive="#2dd4bf" emissiveIntensity={0.7} />
    </mesh>
  </group>;
}

export function AssistantRobot({ level, status }: { level: number; status: AssistantStatus }) {
  return <div className="h-36 w-36 shrink-0" role="img" aria-label={`Drishti assistant avatar, ${status}`}>
    <Canvas dpr={[1, 1.25]} camera={{ position: [0, 0, 3.2], fov: 40 }} gl={{ antialias: false, powerPreference: "low-power" }}>
      <ambientLight intensity={0.8} />
      <pointLight position={[2, 2, 3]} color="#99f6e4" intensity={3} />
      <RobotEye level={level} status={status} />
    </Canvas>
  </div>;
}
