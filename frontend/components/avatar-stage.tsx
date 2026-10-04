"use client";
// AvatarStage — Tier-1 open-source talking avatar for the Rarepath voice
// assistant. Renders a Ready Player Me style GLB head (MIT-licensed sample
// from the TalkingHead project, ARKit + Oculus viseme morph targets) with
// three.js and drives the mouth in real time from the ElevenLabs output
// audio spectrum (getOutputByteFrequencyData from @elevenlabs/react).
//
// No cloud renderer, no extra latency: audio → frequency bands → viseme
// weights → morph targets, every animation frame. Idle life (blinking,
// micro head motion, breathing) keeps the avatar alive between replies.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const AVATAR_URL = "/avatars/rarepath.glb";

type MorphMesh = THREE.Mesh & {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
};

export default function AvatarStage({
  speaking,
  getFrequencyData,
}: {
  speaking: boolean;
  /** Live output-audio spectrum from the ElevenLabs conversation. */
  getFrequencyData?: () => Uint8Array;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Refs so the RAF loop always sees fresh values without re-mounting.
  const speakingRef = useRef(speaking);
  const freqRef = useRef(getFrequencyData);
  speakingRef.current = speaking;
  freqRef.current = getFrequencyData;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);

    // Soft clinical-but-warm portrait lighting.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
    const key = new THREE.DirectionalLight(0xfff1e0, 1.6);
    key.position.set(0.6, 1.2, 1.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 0.8);
    rim.position.set(-1.2, 0.8, -0.8);
    scene.add(rim);

    let disposed = false;
    let raf = 0;
    const morphMeshes: MorphMesh[] = [];
    let headBone: THREE.Object3D | null = null;
    let neckBone: THREE.Object3D | null = null;
    let headBase: THREE.Euler | null = null;
    let neckBase: THREE.Euler | null = null;

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    new GLTFLoader().load(AVATAR_URL, (gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      root.traverse((o) => {
        const m = o as MorphMesh;
        if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) {
          morphMeshes.push(m);
          m.frustumCulled = false;
        }
      });
      headBone = root.getObjectByName("Head") ?? null;
      neckBone = root.getObjectByName("Neck") ?? null;
      if (headBone) headBase = headBone.rotation.clone();
      if (neckBone) neckBase = neckBone.rotation.clone();
      scene.add(root);

      // Frame the camera on the head.
      const target = new THREE.Vector3(0, 1.62, 0);
      if (headBone) {
        headBone.updateWorldMatrix(true, false);
        headBone.getWorldPosition(target);
        target.y += 0.04;
      }
      camera.position.set(0, target.y + 0.02, 0.72);
      camera.lookAt(target);
    });

    // ---- morph helpers -------------------------------------------------
    const current = new Map<string, number>();
    const setMorph = (name: string, value: number) => {
      current.set(name, value);
      for (const m of morphMeshes) {
        const idx = m.morphTargetDictionary[name];
        if (idx !== undefined) m.morphTargetInfluences[idx] = value;
      }
    };
    const lerpMorph = (name: string, target: number, a: number) => {
      const v = current.get(name) ?? 0;
      setMorph(name, v + (target - v) * a);
    };

    const VISEMES = [
      "viseme_aa",
      "viseme_E",
      "viseme_I",
      "viseme_O",
      "viseme_U",
      "viseme_PP",
      "viseme_FF",
      "viseme_SS",
      "viseme_kk",
    ];

    const band = (data: Uint8Array, lo: number, hi: number) => {
      let s = 0;
      const end = Math.min(hi, data.length);
      for (let i = lo; i < end; i++) s += data[i];
      return end > lo ? s / ((end - lo) * 255) : 0;
    };

    // ---- idle life state ----------------------------------------------
    let nextBlink = 1 + Math.random() * 3;
    let blinkT = -1; // <0 idle, 0..1 blinking
    let swayPhase = Math.random() * 10;
    let vowelBias = 0; // slowly wandering vowel preference for variety
    const clock = new THREE.Clock();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = clock.elapsedTime;

      // Blinking.
      nextBlink -= dt;
      if (nextBlink <= 0 && blinkT < 0) {
        blinkT = 0;
        nextBlink = 1.5 + Math.random() * 4;
      }
      if (blinkT >= 0) {
        blinkT += dt / 0.16;
        const k = blinkT >= 1 ? 0 : Math.sin(Math.PI * Math.min(blinkT, 1));
        setMorph("eyeBlinkLeft", k);
        setMorph("eyeBlinkRight", k);
        if (blinkT >= 1) blinkT = -1;
      }

      // Gentle resting expression.
      lerpMorph("mouthSmileLeft", 0.18, 0.02);
      lerpMorph("mouthSmileRight", 0.18, 0.02);
      lerpMorph("browInnerUp", 0.12 + 0.05 * Math.sin(t * 0.3), 0.02);

      // Micro head/neck motion.
      swayPhase += dt;
      if (headBone && headBase) {
        headBone.rotation.x =
          headBase.x + 0.025 * Math.sin(swayPhase * 0.6) + (speakingRef.current ? 0.01 * Math.sin(t * 2.1) : 0);
        headBone.rotation.y = headBase.y + 0.04 * Math.sin(swayPhase * 0.37);
        headBone.rotation.z = headBase.z + 0.015 * Math.sin(swayPhase * 0.53);
      }
      if (neckBone && neckBase) {
        neckBone.rotation.y = neckBase.y + 0.02 * Math.sin(swayPhase * 0.29);
      }

      // ---- lip sync ----------------------------------------------------
      const freq = speakingRef.current ? freqRef.current?.() : undefined;
      if (speakingRef.current && (!freq || !freq.length)) {
        // No audio source (dev preview): synthesize plausible babble.
        const open =
          0.25 +
          0.2 * Math.sin(t * 9.1) * Math.sin(t * 3.7) +
          0.12 * Math.sin(t * 13.3);
        lerpMorph("jawOpen", Math.max(0, open) * 0.5, 0.3);
        lerpMorph("viseme_aa", Math.max(0, Math.sin(t * 5.3)) * 0.5, 0.3);
        lerpMorph("viseme_E", Math.max(0, Math.sin(t * 7.9 + 1)) * 0.4, 0.3);
        lerpMorph("viseme_O", Math.max(0, Math.sin(t * 4.1 + 2)) * 0.4, 0.3);
      } else if (freq && freq.length) {
        // ~48kHz / fftSize 2048 → ~23.4 Hz per bin.
        const voicing = band(freq, 2, 16); //   ~50–375 Hz
        const vowelLo = band(freq, 16, 50); //  ~375–1200 Hz (aa/O/U)
        const vowelHi = band(freq, 50, 130); // ~1.2–3 kHz (E/I)
        const fric = band(freq, 130, 320); //   ~3–7.5 kHz (SS/FF)
        const energy = Math.min(1, (voicing + vowelLo + vowelHi) * 1.6);

        vowelBias += (Math.random() - 0.5) * dt * 2;
        vowelBias = Math.max(-1, Math.min(1, vowelBias));

        const open = Math.pow(energy, 1.3);
        lerpMorph("jawOpen", open * 0.45, 0.35);
        lerpMorph("viseme_aa", Math.min(1, vowelLo * 2.2 * (1 - Math.max(0, vowelBias))) * open, 0.4);
        lerpMorph("viseme_O", Math.min(1, vowelLo * 1.6 * Math.max(0, vowelBias)) * open, 0.35);
        lerpMorph("viseme_E", Math.min(1, vowelHi * 2.4) * open * 0.8, 0.4);
        lerpMorph("viseme_I", Math.min(1, vowelHi * 1.4) * open * 0.4, 0.35);
        lerpMorph("viseme_SS", Math.min(1, fric * 3.0) * 0.6, 0.45);
        lerpMorph("viseme_PP", energy < 0.06 ? 0.3 : 0, 0.3);
      } else {
        // Close the mouth smoothly when not speaking.
        lerpMorph("jawOpen", 0, 0.18);
        for (const v of VISEMES) lerpMorph(v, 0, 0.18);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => mat?.dispose());
        }
      });
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} className="h-full w-full" />;
}
