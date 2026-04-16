import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Hands, HAND_CONNECTIONS, Results } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { motion, AnimatePresence } from 'motion/react';
import { Volume2, VolumeX } from 'lucide-react';


// --- Constants & Types ---
const DOMAIN_STATES = {
  IDLE: 'idle',
  CHARGE: 'charge',
  ASSEMBLE: 'assemble',
  ACTIVE: 'active',
  COLLAPSE: 'collapse'
} as const;

type DomainState = typeof DOMAIN_STATES[keyof typeof DOMAIN_STATES];
type ActiveDomain = 'gojo_void' | 'gojo_red' | 'gojo_blue' | 'gojo_purple' | 'sukuna_shrine' | null;
type VoiceLanguage = 'en' | 'jp';

const VOICE_LANGUAGE_STORAGE_KEY = 'jjk-voice-language';
const DOMAIN_VOICE_LINES: Record<'gojo_void' | 'sukuna_shrine', Record<VoiceLanguage, string>> = {
  gojo_void: {
    en: '/Dialogue/Eng/Gojo-Eng.mp3',
    jp: '/Dialogue/Jap/Gojo-J.mp3'
  },
  sukuna_shrine: {
    en: '/Dialogue/Eng/Sukuna-Eng.mp3',
    jp: '/Dialogue/Jap/Sukuna-J.mp3'
  }
};

export default function JJKExperience() {
  // --- Refs ---
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const handCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Audio Refs
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const sfxRef = useRef<HTMLAudioElement | null>(null);

  // Three.js Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const coreSphereRef = useRef<THREE.Mesh | null>(null);
  const ringMeshRef = useRef<THREE.Mesh | null>(null);
  const starfieldRef = useRef<THREE.Points | null>(null);
  const waterMeshRef = useRef<THREE.Mesh | null>(null);

  // New Gojo-specific Refs
  const kanjiCanvasRef = useRef<HTMLCanvasElement>(null);
  const raysCanvasRef = useRef<HTMLCanvasElement>(null);
  const crackOverlayRef = useRef<HTMLDivElement>(null);
  const sixEyesRef = useRef<HTMLDivElement>(null);
  const kanjiRainStateRef = useRef({ running: false, phaseRAF: 0, overloadRAF: 0 });
  const raysStateRef = useRef({ running: false, raf: 0, angle: 0 });
  const bgmPauseStateRef = useRef({
    time: 0,
    shouldResume: false,
    pausedForVoice: false
  });
  const voicePlaybackIdRef = useRef(0);

  // State Refs (for the loop)
  const stateRef = useRef({
    domainState: DOMAIN_STATES.IDLE as DomainState,
    activeDomain: null as ActiveDomain,
    domainClock: 0,
    domainInteraction: 0,
    pulseStrength: 0,
    lastPulseTime: 0,
    mouse: new THREE.Vector2(-9999, -9999),
    fingertipWorld: new THREE.Vector3(0, 0, 0),
    fingertipRed: new THREE.Vector3(0, 0, 0),
    fingertipBlue: new THREE.Vector3(0, 0, 0),
    fingertipRedVel: new THREE.Vector3(0, 0, 0),
    fingertipBlueVel: new THREE.Vector3(0, 0, 0),
    lastHandTime: 0,
    activeTechniques: {
      red: false,
      blue: false,
      purple: false
    },
    techBlendRed: 0,
    techBlendBlue: 0,
    techBlendPurple: 0,
    purpleShockwave: 0,
    purpleProximity: 0,
    purpleCooldown: 0,
    purplePhase: 'none' as 'none' | 'forming' | 'active' | 'imploding',
    purpleClock: 0,
    holdCounts: {
      gojo_void: 0,
      gojo_red: 0,
      gojo_blue: 0,
      gojo_purple: 0,
      sukuna_shrine: 0
    },
    lostCounts: {
      gojo_void: 0,
      gojo_red: 0,
      gojo_blue: 0,
      gojo_purple: 0,
      sukuna_shrine: 0
    }
  });

  // --- React State ---
  const [isInitialized, setIsInitialized] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [currentDomainName, setCurrentDomainName] = useState<string>('—');
  const [cameraStatus, setCameraStatus] = useState<'Off' | 'Active'>('Off');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [gestureProgress, setGestureProgress] = useState(0);
  const [detectedSign, setDetectedSign] = useState<string | null>(null);
  const [slashes, setSlashes] = useState<{ id: number; style: React.CSSProperties }[]>([]);
  const [debris, setDebris] = useState<{ id: number; style: React.CSSProperties }[]>([]);
  const [showCinematicText, setShowCinematicText] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [activePill, setActivePill] = useState<string | null>(null);
  const [showCracks, setShowCracks] = useState(false);
  const [domainShock, setDomainShock] = useState(false);
  const [isPurpleReady, setIsPurpleReady] = useState(false);
  const [showHoldInstruction, setShowHoldInstruction] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>(() => {
    if (typeof window === 'undefined') return 'en';

    try {
      const savedLanguage = window.localStorage.getItem(VOICE_LANGUAGE_STORAGE_KEY);
      return savedLanguage === 'jp' ? 'jp' : 'en';
    } catch {
      return 'en';
    }
  });
  const voiceLanguageRef = useRef<VoiceLanguage>(voiceLanguage);
  const slashIdRef = useRef(0);

  const debrisIdRef = useRef(0);

  // --- Initialization ---

  useEffect(() => {
    // Initialize BGM
    const bgm = new Audio('/BGM.mp3');
    bgm.loop = true;
    bgm.volume = 0.5;
    bgmRef.current = bgm;

    const voice = new Audio();
    voice.preload = 'auto';
    voiceRef.current = voice;

    return () => {
      voice.pause();
      voice.onended = null;
      voice.onerror = null;
      voice.src = "";
      bgm.pause();
      bgm.src = "";
    };
  }, []);

  useEffect(() => {
    if (bgmRef.current) {
      bgmRef.current.muted = isMuted;
    }

    if (voiceRef.current) {
      voiceRef.current.muted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    voiceLanguageRef.current = voiceLanguage;

    try {
      window.localStorage.setItem(VOICE_LANGUAGE_STORAGE_KEY, voiceLanguage);
    } catch {
      // Ignore storage failures and keep the in-memory selection active.
    }
  }, [voiceLanguage]);

  useEffect(() => {

    if (!isInitialized) return;

    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current || !composerRef.current) return;
      const width = window.innerWidth;
      const height = window.innerHeight;

      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();

      rendererRef.current.setSize(width, height);
      composerRef.current.setSize(width, height);

      if (handCanvasRef.current) {
        handCanvasRef.current.width = width;
        handCanvasRef.current.height = height;
      }
      if (kanjiCanvasRef.current) {
        kanjiCanvasRef.current.width = width;
        kanjiCanvasRef.current.height = height;
      }
    };

    // Initialize Three.js
    initThree();
    
    // Initial resize call to set canvas dimensions
    handleResize();
    
    // Initialize MediaPipe
    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera API not supported in this browser or not in a secure context (HTTPS).');
        return;
      }

      const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        selfieMode: true,
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      hands.onResults(onHandResults);

      if (videoRef.current) {
        try {
          setCameraError(null);
          // Explicitly request permission first
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480 } 
          });
          
          // If we got the stream, we can stop it and let the Camera utility take over
          // or just use it. MediaPipe Camera utility is better for synchronization.
          stream.getTracks().forEach(track => track.stop());

          const camera = new Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current) {
                await hands.send({ image: videoRef.current });
              }
            },
            width: 640,
            height: 480
          });

          await camera.start();
          setCameraStatus('Active');
          setCameraError(null);
        } catch (err: any) {
          console.error("Camera failed to start:", err);
          setCameraStatus('Off');
          if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied') || err.name === 'PermissionDeniedError') {
            setCameraError('Camera permission denied. Please allow camera access in your browser settings and click Retry.');
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setCameraError('No camera device found. Please connect a camera and click Retry.');
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            setCameraError('Camera is already in use by another application. Please close it and click Retry.');
          } else {
            setCameraError('Failed to access camera: ' + (err.message || 'Unknown error'));
          }
        }
      }

      return hands;
    };

    let handsInstance: Hands | undefined;
    startCamera().then(instance => {
      handsInstance = instance;
    });

    window.addEventListener('resize', handleResize);

    return () => {
      // Cleanup
      window.removeEventListener('resize', handleResize);
      rendererRef.current?.dispose();
      if (handsInstance) handsInstance.close();
    };
  }, [isInitialized, retryCount]);

  const handleRetryCamera = () => {
    setRetryCount(prev => prev + 1);
  };

  const makeGlowTexture = (innerColor: string, midColor: string, outerColor: string) => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, innerColor);
    grad.addColorStop(0.4, midColor);
    grad.addColorStop(1, outerColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);
  };

  const initThree = () => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 10;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(1); // Force 1 for performance
    rendererRef.current = renderer;

    // Post-processing
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), // Half res bloom
      1.4, 0.4, 0.85
    );
    composer.addPass(bloomPass);
    composerRef.current = composer;
    bloomPassRef.current = bloomPass;

    // Particles
    const particleCount = 3000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    // We'll store target positions for each domain in refs
    const idlePositions = new Float32Array(particleCount * 3);
    const voidPositions = new Float32Array(particleCount * 3);
    const redPositions = new Float32Array(particleCount * 3);
    const bluePositions = new Float32Array(particleCount * 3);
    const purplePositions = new Float32Array(particleCount * 3);
    const shrinePositions = new Float32Array(particleCount * 3);

    const idleColors = new Float32Array(particleCount * 3);
    const voidColors = new Float32Array(particleCount * 3);
    const redColors = new Float32Array(particleCount * 3);
    const blueColors = new Float32Array(particleCount * 3);
    const purpleColors = new Float32Array(particleCount * 3);
    const shrineColors = new Float32Array(particleCount * 3);

    const voidDistances = new Float32Array(particleCount);
    const voidYDistances = new Float32Array(particleCount);
    const shrineDistances = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      
      // Idle
      idlePositions[i3] = (Math.random() - 0.5) * 40;
      idlePositions[i3 + 1] = (Math.random() - 0.5) * 20;
      idlePositions[i3 + 2] = (Math.random() - 0.5) * 30;
      
      // Neutral idle colors: bluish/teal/grey cursed energy
      const idleVariant = Math.random();
      if (idleVariant < 0.5) {
        idleColors[i3] = 0.1 + Math.random() * 0.1;   // low red
        idleColors[i3 + 1] = 0.4 + Math.random() * 0.3; // mid green
        idleColors[i3 + 2] = 0.7 + Math.random() * 0.3; // high blue
      } else if (idleVariant < 0.8) {
        idleColors[i3] = 0.3 + Math.random() * 0.2;
        idleColors[i3 + 1] = 0.5 + Math.random() * 0.2;
        idleColors[i3 + 2] = 0.8 + Math.random() * 0.2;
      } else {
        idleColors[i3] = 0.8;
        idleColors[i3 + 1] = 0.9;
        idleColors[i3 + 2] = 1.0;
      }

      // Gojo Void
      const region = i / particleCount;
      if (region < 0.08) {
        // Central singularity cloud
        const r = Math.pow(Math.random(), 1.8) * 1.2;
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = 2 * Math.PI * Math.random();
        voidPositions[i3] = r * Math.sin(phi) * Math.cos(theta);
        voidPositions[i3 + 1] = r * Math.cos(phi);
        voidPositions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);

        const br = 0.9 + Math.random() * 0.1;
        voidColors[i3] = br;
        voidColors[i3 + 1] = br * 0.6;
        voidColors[i3 + 2] = br;
      } else if (region < 0.55) {
        // Spherical shell
        const R = 4.0;
        const t = Math.random();
        const phi = Math.acos(2 * t - 1);
        const theta = 2 * Math.PI * Math.random();
        voidPositions[i3] = R * Math.sin(phi) * Math.cos(theta);
        voidPositions[i3 + 1] = R * Math.cos(phi);
        voidPositions[i3 + 2] = R * Math.sin(phi) * Math.sin(theta);

        const lat = Math.abs(Math.cos(phi));
        voidColors[i3] = 0.4 + lat * 0.5;
        voidColors[i3 + 1] = 0.1 + lat * 0.3;
        voidColors[i3 + 2] = 0.8 + lat * 0.2;
      } else if (region < 0.8) {
        // Equatorial / latitude rings
        const ringLat = (Math.random() < 0.5 ? 20 : -20) * Math.PI / 180;
        const R = 4.4 + (Math.random() - 0.5) * 0.4;
        const ang = Math.random() * Math.PI * 2;
        voidPositions[i3] = Math.cos(ang) * R;
        voidPositions[i3 + 1] = Math.sin(ringLat) * 4.0 + (Math.random() - 0.5) * 0.2;
        voidPositions[i3 + 2] = Math.sin(ang) * R;

        voidColors[i3] = 0.8 + Math.random() * 0.2;
        voidColors[i3 + 1] = 0.3 + Math.random() * 0.2;
        voidColors[i3 + 2] = 1.0;
      } else {
        // Outer halo
        const R = 6.0 + Math.random() * 3.0;
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = 2 * Math.PI * Math.random();
        voidPositions[i3] = R * Math.sin(phi) * Math.cos(theta);
        voidPositions[i3 + 1] = R * Math.cos(phi);
        voidPositions[i3 + 2] = R * Math.sin(phi) * Math.sin(theta);

        const dk = 0.15 + Math.random() * 0.2;
        voidColors[i3] = dk * 0.6;
        voidColors[i3 + 1] = dk * 0.2;
        voidColors[i3 + 2] = dk;
      }

      voidDistances[i] = Math.sqrt(voidPositions[i3]**2 + voidPositions[i3+1]**2 + voidPositions[i3+2]**2);
      voidYDistances[i] = Math.sqrt(voidPositions[i3]**2 + voidPositions[i3+2]**2) + 1e-6;

      // Gojo Red
      if (i < 2000) { 
        const r_r = Math.pow(Math.random(), 1.5) * 0.22;
        const phi_r = Math.acos(2 * Math.random() - 1);
        const theta_r = 2 * Math.PI * Math.random();
        redPositions[i3] = r_r * Math.sin(phi_r) * Math.cos(theta_r);
        redPositions[i3 + 1] = r_r * Math.cos(phi_r);
        redPositions[i3 + 2] = r_r * Math.sin(phi_r) * Math.sin(theta_r);
        redColors[i3] = 0.9;
        redColors[i3 + 1] = 0.0;
        redColors[i3 + 2] = 0.0;
      } else {
        redPositions[i3] = idlePositions[i3];
        redPositions[i3 + 1] = idlePositions[i3 + 1];
        redPositions[i3 + 2] = idlePositions[i3 + 2];
        redColors[i3] = idleColors[i3] * 0.2;
        redColors[i3 + 1] = idleColors[i3 + 1] * 0.2;
        redColors[i3 + 2] = idleColors[i3 + 2] * 0.2;
      }

      // Gojo Blue
      if (i >= 1000) { 
        const r_b = Math.pow(Math.random(), 3.0) * 0.15; // Extremely concentrated singularity
        const phi_b = Math.acos(2 * Math.random() - 1);
        const theta_b = 2 * Math.PI * Math.random();
        bluePositions[i3] = r_b * Math.sin(phi_b) * Math.cos(theta_b);
        bluePositions[i3 + 1] = r_b * Math.cos(phi_b);
        bluePositions[i3 + 2] = r_b * Math.sin(phi_b) * Math.sin(theta_b);
        blueColors[i3] = 0.0;
        blueColors[i3 + 1] = 0.6; // Deep Cyan/Blue
        blueColors[i3 + 2] = 1.0;
      } else {
        bluePositions[i3] = idlePositions[i3];
        bluePositions[i3 + 1] = idlePositions[i3 + 1];
        bluePositions[i3 + 2] = idlePositions[i3 + 2];
        blueColors[i3] = idleColors[i3] * 0.2;
        blueColors[i3 + 1] = idleColors[i3 + 1] * 0.2;
        blueColors[i3 + 2] = idleColors[i3 + 2] * 0.2;
      }

      // Gojo Purple (Hollow Purple)
      const r_p = Math.pow(Math.random(), 2.0) * 0.45;
      const phi_p = Math.acos(2 * Math.random() - 1);
      const theta_p = 2 * Math.PI * Math.random();
      purplePositions[i3] = r_p * Math.sin(phi_p) * Math.cos(theta_p);
      purplePositions[i3 + 1] = r_p * Math.cos(phi_p);
      purplePositions[i3 + 2] = r_p * Math.sin(phi_p) * Math.sin(theta_p);
      
      const pVariant = Math.random();
      if (pVariant < 0.6) {
        purpleColors[i3] = 0.6 + Math.random() * 0.4; // Bright Purple/Violet
        purpleColors[i3 + 1] = 0.0;
        purpleColors[i3 + 2] = 0.8 + Math.random() * 0.2;
      } else if (pVariant < 0.85) {
        purpleColors[i3] = 0.4 + Math.random() * 0.2; // Deep Violet
        purpleColors[i3 + 1] = 0.0;
        purpleColors[i3 + 2] = 0.6 + Math.random() * 0.4;
      } else {
        purpleColors[i3] = 0.9 + Math.random() * 0.1; // White-hot purple sparks
        purpleColors[i3 + 1] = 0.7 + Math.random() * 0.3;
        purpleColors[i3 + 2] = 1.0;
      }

      // Sukuna Shrine
      const r_s = Math.random();
      if (r_s < 0.18) {
        // Central blood pool
        const radius = Math.pow(Math.random(), 1.4) * 3.3;
        const angle = Math.random() * Math.PI * 2;
        shrinePositions[i3] = Math.cos(angle) * radius;
        shrinePositions[i3 + 1] = -2.4 + Math.random() * 0.8;
        shrinePositions[i3 + 2] = Math.sin(angle) * radius;

        shrineColors[i3] = 1.0;
        shrineColors[i3 + 1] = 0.05 + Math.random() * 0.1;
        shrineColors[i3 + 2] = 0.1;
      } else if (r_s < 0.5) {
        // Torii pillars (vertical)
        const side = Math.random() < 0.5 ? -1 : 1;
        const x = side * (3.1 + Math.random() * 0.3);
        const y = -2 + Math.random() * 6.5;
        const z = -2 + (Math.random() - 0.5) * 0.6;
        shrinePositions[i3] = x;
        shrinePositions[i3 + 1] = y;
        shrinePositions[i3 + 2] = z;

        shrineColors[i3] = 0.95;
        shrineColors[i3 + 1] = 0.08;
        shrineColors[i3 + 2] = 0.05;
      } else if (r_s < 0.64) {
        // Crossbeam + inner frame
        const x = (Math.random() - 0.5) * 7.2;
        const y = 2.0 + (Math.random() - 0.5) * 0.9;
        const z = -2 + (Math.random() - 0.5) * 0.4;
        shrinePositions[i3] = x;
        shrinePositions[i3 + 1] = y;
        shrinePositions[i3 + 2] = z;

        shrineColors[i3] = 0.9;
        shrineColors[i3 + 1] = 0.1;
        shrineColors[i3 + 2] = 0.08;
      } else if (r_s < 0.78) {
        // Roof shape
        const x = (Math.random() - 0.5) * 9.0;
        const y = 3.1 + Math.random() * 1.1;
        const z = -2.3 + (Math.random() - 0.5) * 0.6;
        shrinePositions[i3] = x;
        shrinePositions[i3 + 1] = y;
        shrinePositions[i3 + 2] = z;

        shrineColors[i3] = 0.85;
        shrineColors[i3 + 1] = 0.12;
        shrineColors[i3 + 2] = 0.1;
      } else if (r_s < 0.9) {
        // Horn arcs above roof
        const arc = (Math.random() - 0.5) * 1.4;
        const radius = 4.2 + Math.random() * 0.8;
        shrinePositions[i3] = Math.cos(arc) * radius;
        shrinePositions[i3 + 1] = 3.2 + Math.sin(arc) * 1.6;
        shrinePositions[i3 + 2] = -2.6 + (Math.random() - 0.5) * 0.6;

        shrineColors[i3] = 0.9;
        shrineColors[i3 + 1] = 0.15;
        shrineColors[i3 + 2] = 0.12;
      } else {
        // Distant debris / slashes / skull ring hints
        const radius = 4.0 + Math.random() * 5.5;
        const theta = Math.random() * Math.PI * 2;
        const y = -2.8 + Math.random() * 4.5;
        shrinePositions[i3] = Math.cos(theta) * radius;
        shrinePositions[i3 + 1] = y;
        shrinePositions[i3 + 2] = Math.sin(theta) * radius - 1.5;

        shrineColors[i3] = 0.8;
        shrineColors[i3 + 1] = 0.05;
        shrineColors[i3 + 2] = 0.05 + Math.random() * 0.1;
      }

      shrineDistances[i] = Math.sqrt(shrinePositions[i3]**2 + (shrinePositions[i3+1]+1.2)**2 + (shrinePositions[i3+2]+0.4)**2);

      positions[i3] = idlePositions[i3];
      positions[i3 + 1] = idlePositions[i3 + 1];
      positions[i3 + 2] = idlePositions[i3 + 2];
      colors[i3] = idleColors[i3];
      colors[i3 + 1] = idleColors[i3 + 1];
      colors[i3 + 2] = idleColors[i3 + 2];
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Bluish/White glow texture from HTML
    const texture = makeGlowTexture('rgba(255,255,255,1)', 'rgba(160,216,239,0.95)', 'rgba(0,0,0,0)');

    const material = new THREE.PointsMaterial({
      size: 0.12,
      map: texture,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.8
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    particlesRef.current = particles;

    // Store target arrays in a ref for the animation loop
    (particles as any).userData = {
      idlePositions, voidPositions, redPositions, bluePositions, purplePositions, shrinePositions,
      idleColors, voidColors, redColors, blueColors, purpleColors, shrineColors,
      voidDistances, voidYDistances, shrineDistances
    };

    // Core Sphere
    const coreGeo = new THREE.SphereGeometry(1.3, 64, 64);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x020007, transparent: true, opacity: 0 });
    const coreSphere = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreSphere);
    coreSphereRef.current = coreSphere;

    // Ring (Boundary wireframe sphere for Gojo)
    const ringGeo = new THREE.SphereGeometry(6.5, 32, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xaaddff, wireframe: true, transparent: true, opacity: 0 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    scene.add(ringMesh);
    ringMeshRef.current = ringMesh;

    // Water (Sukuna)
    const waterGeo = new THREE.PlaneGeometry(80, 80, 64, 64);

    // Start Animation Loop
    animate();
  };

  const animate = () => {
    requestAnimationFrame(animate);
    const state = stateRef.current;
    const delta = 0.016; // Approx 60fps
    state.domainClock += delta;

    // Update logic based on state
    handleStateTransitions(delta);

    const isSukuna = state.activeDomain === 'sukuna_shrine';
    const isForming = state.domainState === DOMAIN_STATES.ASSEMBLE;
    const isActive = state.domainState === DOMAIN_STATES.ACTIVE;

    if (isSukuna && (isActive || isForming)) {
      const progress = isForming ? (state.domainClock / 0.65) : 1;
      const intensity = Math.max(0.15, progress); // Start with some slashes immediately
      
      // Near-constant spawn frequency - scaled by intensity
      if (Math.random() < 0.99 * intensity) {
        spawnSlash();
      }
      // Massive bursts of slashes - scaled by intensity
      if (Math.random() < 0.5 * intensity) {
        const burstSize = Math.floor((12 + Math.floor(Math.random() * 18)) * intensity);
        for (let i = 0; i < burstSize; i++) spawnSlash();
      }

      // Debris spawn - scaled by intensity
      if (Math.random() < 0.3 * intensity) {
        spawnDebris();
      }
    }

    // Update Three.js objects
    updateVisuals(delta);

    if (composerRef.current) {
      composerRef.current.render();
    }
  };

  const spawnSlash = () => {
    const id = slashIdRef.current++;
    const isBig = Math.random() < 0.35; // 35% chance for big slashes
    const startX = Math.random() * 100;
    const startY = Math.random() * 100;
    const length = isBig ? (100 + Math.random() * 120) : (25 + Math.random() * 50);
    const angle = (Math.random() * 360); // Full rotation range
    const thickness = isBig ? (2.0 + Math.random() * 4.0) : (0.1 + Math.random() * 0.4);

    const style: React.CSSProperties = {
      left: `${startX}%`,
      top: `${startY}%`,
      width: `${length}vmin`,
      height: `${thickness}vmin`,
      transform: `rotate(${angle}deg) scaleX(0.01)`,
      opacity: 0,
      boxShadow: isBig ? '0 0 50px rgba(255, 0, 0, 1), 0 0 20px rgba(255, 255, 255, 0.8)' : '0 0 15px rgba(255, 50, 50, 0.8)',
      background: 'linear-gradient(90deg, transparent, #ff1111, #ffffff, #ff1111, transparent)',
      zIndex: isBig ? 160 : 155,
      filter: 'brightness(1.5) contrast(1.2)',
    };

    setSlashes(prev => [...prev, { id, style }]);

    setTimeout(() => {
      setSlashes(prev => prev.map(s => s.id === id ? { ...s, style: { ...s.style, transform: `rotate(${angle}deg) scaleX(2.8)`, opacity: 1 } } : s));
    }, 5);

    setTimeout(() => {
      setSlashes(prev => prev.filter(s => s.id !== id));
    }, 70);
  };

  const spawnDebris = () => {
    const id = debrisIdRef.current++;
    const edge = Math.floor(Math.random() * 4);
    let x = Math.random() * 100;
    let y = Math.random() * 100;
    
    // Explosive direction based on edge
    let moveX = (Math.random() - 0.5) * 100;
    let moveY = (Math.random() - 0.5) * 100;

    if (edge === 0) { x = Math.random() * 10; moveX = 50 + Math.random() * 100; } // Left -> Right
    else if (edge === 1) { x = 90 + Math.random() * 10; moveX = -50 - Math.random() * 100; } // Right -> Left
    else if (edge === 2) { y = Math.random() * 10; moveY = 50 + Math.random() * 100; } // Top -> Bottom
    else if (edge === 3) { y = 90 + Math.random() * 10; moveY = -50 - Math.random() * 100; } // Bottom -> Top

    const size = 0.5 + Math.random() * 3;
    const rotation = Math.random() * 720;
    const duration = 300 + Math.random() * 500;
    
    const shapes = [
      'polygon(50% 0%, 0% 100%, 100% 100%)',
      'polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)',
      'polygon(0% 20%, 100% 0%, 80% 100%, 20% 80%)',
      'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
    ];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];

    const style: React.CSSProperties = {
      left: `${x}%`,
      top: `${y}%`,
      width: `${size}vmin`,
      height: `${size}vmin`,
      background: Math.random() > 0.5 ? '#1a1a1a' : '#2a2a2a',
      clipPath: shape,
      opacity: 0,
      transform: `rotate(${rotation}deg) scale(0.2)`,
      transition: `all ${duration}ms cubic-bezier(0.1, 0.5, 0.1, 1)`,
      zIndex: 140,
      filter: 'drop-shadow(0 0 5px rgba(0,0,0,0.9))',
    };

    setDebris(prev => [...prev, { id, style }]);

    setTimeout(() => {
      setDebris(prev => prev.map(d => d.id === id ? { 
        ...d, 
        style: { 
          ...d.style, 
          opacity: 1, 
          transform: `rotate(${rotation + 360}deg) scale(1.5) translate(${moveX}px, ${moveY}px)` 
        } 
      } : d));
    }, 10);

    setTimeout(() => {
      setDebris(prev => prev.map(d => d.id === id ? { ...d, style: { ...d.style, opacity: 0 } } : d));
    }, duration * 0.8);

    setTimeout(() => {
      setDebris(prev => prev.filter(d => d.id !== id));
    }, duration);
  };

  const handleStateTransitions = (delta: number) => {
    const state = stateRef.current;
    
    // Update cooldowns
    if (state.purpleCooldown > 0) {
      state.purpleCooldown = Math.max(0, state.purpleCooldown - delta);
    }

    const isGojoVoid = state.activeDomain === 'gojo_void';
    const isSukuna = state.activeDomain === 'sukuna_shrine';
    const chargeDur = isGojoVoid ? 0.25 : 0.2;
    const assembleDur = isGojoVoid ? 0.95 : isSukuna ? 0.55 : 0.65;
    const collapseDur = isGojoVoid ? 0.9 : 0.6;

    if (state.domainState === DOMAIN_STATES.CHARGE) {
      if (state.domainClock >= chargeDur) {
        state.domainState = DOMAIN_STATES.ASSEMBLE;
        state.domainClock = 0;
      }
    } else if (state.domainState === DOMAIN_STATES.ASSEMBLE) {
      if (state.domainClock >= assembleDur) {
        state.domainState = DOMAIN_STATES.ACTIVE;
        state.domainClock = 0;
      }
    } else if (state.domainState === DOMAIN_STATES.COLLAPSE) {
      if (state.domainClock >= collapseDur) {
        state.domainState = DOMAIN_STATES.IDLE;
        state.activeDomain = null;
        state.domainClock = 0;
        setCurrentDomainName('—');
      }
    }
  };

  const updateVisuals = (delta: number) => {
    const state = stateRef.current;
    const particles = particlesRef.current;
    if (!particles) return;

    const userData = (particles as any).userData;
    const positions = particles.geometry.attributes.position.array as Float32Array;
    const colors = particles.geometry.attributes.color.array as Float32Array;

    let blendT = 0;
    const isGojoVoid = state.activeDomain === 'gojo_void';
    const isSukuna = state.activeDomain === 'sukuna_shrine';
    const isRed = state.activeDomain === 'gojo_red' || state.techBlendRed > 0;
    const isBlue = state.activeDomain === 'gojo_blue' || state.techBlendBlue > 0;
    const isPurple = state.techBlendPurple > 0;
    
    const assembleDur = isGojoVoid ? 0.95 : isSukuna ? 0.8 : 0.65;
    const collapseDur = isGojoVoid ? 0.9 : 0.6;

    if (state.domainState === DOMAIN_STATES.ASSEMBLE) {
      blendT = easeInOutCubic(Math.min(state.domainClock / assembleDur, 1));
    } else if (state.domainState === DOMAIN_STATES.ACTIVE) {
      blendT = 1;
    } else if (state.domainState === DOMAIN_STATES.COLLAPSE) {
      blendT = 1 - easeInOutCubic(Math.min(state.domainClock / collapseDur, 1));
    } else if (state.activeDomain === null && (isRed || isBlue)) {
      blendT = 1;
    }

    // Update pulse strength
    if (state.domainState === DOMAIN_STATES.ACTIVE) {
      if (isGojoVoid) {
        // Gojo Void specific pulse logic (Information Overload)
        // Use a threshold that doesn't reset domainClock to allow for timing other effects
        if (state.pulseStrength <= 0 && state.domainClock - state.lastPulseTime > 2.5 + Math.random() * 2) {
          state.lastPulseTime = state.domainClock;
          state.pulseStrength = 1.0;
        }
        if (state.pulseStrength > 0) {
          state.pulseStrength = Math.max(0, state.pulseStrength - delta * 1.6);
        }
      } else {
        // Default pulse logic
        state.pulseStrength = Math.sin(Date.now() * 0.002) * 0.5 + 0.5;
      }
    } else {
      state.pulseStrength = 0;
    }

    const targetPos = state.activeDomain === 'gojo_void' ? userData.voidPositions :
                     state.activeDomain === 'gojo_red' ? userData.redPositions :
                     state.activeDomain === 'gojo_blue' ? userData.bluePositions :
                     state.activeDomain === 'sukuna_shrine' ? userData.shrinePositions :
                     userData.idlePositions;

    const targetCol = state.activeDomain === 'gojo_void' ? userData.voidColors :
                     state.activeDomain === 'gojo_red' ? userData.redColors :
                     state.activeDomain === 'gojo_blue' ? userData.blueColors :
                     state.activeDomain === 'sukuna_shrine' ? userData.shrineColors :
                                           userData.idleColors;

    const isVoid = state.activeDomain === 'gojo_void';
    
    const time = Date.now() * 0.001;
    const interaction = state.domainInteraction;
    const pulse = state.pulseStrength;

    // Camera motion for Gojo Void
    if (isVoid && cameraRef.current) {
      const baseRadius = 10;
      const pulseZoom = pulse * 0.7 + interaction * 0.5;
      const orbitX = Math.cos(time * 0.15) * 0.4;
      const orbitY = Math.sin(time * 0.12) * 0.3;
      cameraRef.current.position.set(orbitX, orbitY, baseRadius - (pulseZoom * blendT));
      cameraRef.current.lookAt(0, 0, 0);
    }

    const idlePos = userData.idlePositions;
    const idleCol = userData.idleColors;

    // Pre-calculate rotation values if in void
    let cosY = 1, sinY = 0;
    if (isVoid && blendT >= 0.95) {
      const rotY = time * (0.16 + 0.08 * interaction);
      cosY = Math.cos(rotY);
      sinY = Math.sin(rotY);
    }

    for (let i = 0; i < positions.length / 3; i++) {
      const i3 = i * 3;
      let tx = targetPos[i3];
      let ty = targetPos[i3 + 1];
      let tz = targetPos[i3 + 2];
      
      let tr = targetCol[i3];
      let tg = targetCol[i3 + 1];
      let tb = targetCol[i3 + 2];

      // Handle simultaneous Red and Blue techniques
      if (state.activeDomain === null) {
        const rW = state.techBlendRed;
        const bW = state.techBlendBlue;
        const pW = state.techBlendPurple;
        
        let redWeight = 0;
        let blueWeight = 0;
        let purpleWeight = pW;
        
        if (i < 1000) {
          redWeight = rW * (1 - pW);
          blueWeight = 0;
        } else if (i >= 2000) {
          redWeight = 0;
          blueWeight = bW * (1 - pW);
        } else if (i >= 1000 && i < 1500) {
          redWeight = rW * (1 - pW);
          blueWeight = bW * (1 - rW) * (1 - pW);
        } else { // 1500 - 1999
          redWeight = rW * (1 - bW) * (1 - pW);
          blueWeight = bW * (1 - pW);
        }

        const ix = idlePos[i3], iy = idlePos[i3+1], iz = idlePos[i3+2];
        const ir = idleCol[i3], ig = idleCol[i3+1], ib = idleCol[i3+2];
        
        const rx = userData.redPositions[i3], ry = userData.redPositions[i3+1], rz = userData.redPositions[i3+2];
        const rr = userData.redColors[i3], rg = userData.redColors[i3+1], rb = userData.redColors[i3+2];
        
        const bx_ = userData.bluePositions[i3], by_ = userData.bluePositions[i3+1], bz_ = userData.bluePositions[i3+2];
        const br = userData.blueColors[i3], bg = userData.blueColors[i3+1], bb = userData.blueColors[i3+2];

        const px = userData.purplePositions[i3], py = userData.purplePositions[i3+1], pz = userData.purplePositions[i3+2];
        const pr = userData.purpleColors[i3], pg = userData.purpleColors[i3+1], pb = userData.purpleColors[i3+2];

        const wIdle = (1 - redWeight) * (1 - blueWeight) * (1 - purpleWeight);
        tx = ix * wIdle + rx * redWeight * (1 - blueWeight) * (1 - purpleWeight) + bx_ * blueWeight * (1 - purpleWeight) + px * purpleWeight;
        ty = iy * wIdle + ry * redWeight * (1 - blueWeight) * (1 - purpleWeight) + by_ * blueWeight * (1 - purpleWeight) + py * purpleWeight;
        tz = iz * wIdle + rz * redWeight * (1 - blueWeight) * (1 - purpleWeight) + bz_ * blueWeight * (1 - purpleWeight) + pz * purpleWeight;
        
        tr = ir * wIdle + rr * redWeight * (1 - blueWeight) * (1 - purpleWeight) + br * blueWeight * (1 - purpleWeight) + pr * purpleWeight;
        tg = ig * wIdle + rg * redWeight * (1 - blueWeight) * (1 - purpleWeight) + bg * blueWeight * (1 - purpleWeight) + pg * purpleWeight;
        tb = ib * wIdle + rb * redWeight * (1 - blueWeight) * (1 - purpleWeight) + bb * blueWeight * (1 - purpleWeight) + pb * purpleWeight;
      }

      let bx, by, bz;
      
      if (state.activeDomain !== null) {
        if (blendT >= 1) {
          bx = tx; by = ty; bz = tz;
        } else {
          const ix = idlePos[i3];
          const iy = idlePos[i3 + 1];
          const iz = idlePos[i3 + 2];
          bx = ix + (tx - ix) * blendT;
          by = iy + (ty - iy) * blendT;
          bz = iz + (tz - iz) * blendT;
        }
      } else {
        // Techniques already blended into tx, ty, tz above
        bx = tx; by = ty; bz = tz;
      }

      // Add some movement
      if (blendT < 0.95 && state.activeDomain !== null) {
        const drift = time * 0.18 + i * 0.07;
        bx += Math.sin(drift) * 0.02;
        by += Math.cos(drift * 1.1) * 0.02;
        bz += Math.sin(drift * 0.9) * 0.02;
      } else if (isVoid) {
        // Fully in domain: stable shape with slow rotational motion
        const rx = bx;
        const rz = bz;
        bx = rx * cosY - rz * sinY;
        bz = rx * sinY + rz * cosY;

        // Secondary gentle tilt-like motion
        const swirlPhase = time * 0.22 + i * 0.021;
        const swirlStrength = 0.08 * (0.7 + 0.3 * interaction);
        const rLen = userData.voidYDistances[i];
        const swirl = Math.sin(swirlPhase) * swirlStrength;
        bx += (-bz / rLen) * swirl;
        bz += (bx / rLen) * swirl;
        by += Math.cos(swirlPhase * 1.15) * 0.03;
      }

      // Apply fingertip offsets for techniques
      if (state.activeDomain === null) {
        const rW = state.techBlendRed;
        const bW = state.techBlendBlue;
        const pW = state.techBlendPurple;
        
        let redWeight = 0;
        let blueWeight = 0;
        let purpleWeight = pW;

        if (i < 1000) { redWeight = rW * (1 - pW); }
        else if (i >= 2000) { blueWeight = bW * (1 - pW); }
        else if (i >= 1000 && i < 1500) { redWeight = rW * (1 - pW); blueWeight = bW * (1 - rW) * (1 - pW); }
        else { redWeight = rW * (1 - bW) * (1 - pW); blueWeight = bW * (1 - pW); }

        if (redWeight > 0) {
          const targetX = state.fingertipRed.x;
          const targetY = state.fingertipRed.y + 0.15;
          const targetZ = state.fingertipRed.z;
          bx += targetX * redWeight;
          by += targetY * redWeight;
          bz += targetZ * redWeight;
        }
        if (blueWeight > 0) {
          const suck = 0.12 * Math.sin(time * 12 + i * 0.1);
          const sX = bx * (1 - suck), sY = by * (1 - suck), sZ = bz * (1 - suck);
          
          const targetX = state.fingertipBlue.x;
          const targetY = state.fingertipBlue.y + 0.15;
          const targetZ = state.fingertipBlue.z;

          const bX = sX + targetX;
          const bY = sY + targetY;
          const bZ = sZ + targetZ;
          
          bx = bx * (1 - blueWeight) + bX * blueWeight;
          by = by * (1 - blueWeight) + bY * blueWeight;
          bz = bz * (1 - blueWeight) + bZ * blueWeight;
        }
        if (purpleWeight > 0) {
          // Hollow Purple Animation: Swirl, Expand, Implode
          const pPhase = state.purplePhase;
          const pClock = state.purpleClock;
          
          let pScale = 1.0;
          if (pPhase === 'forming') {
            pScale = 0.4 + Math.sin(pClock * 12) * 0.15;
          } else if (pPhase === 'active') {
            // Expansion - more exponential
            pScale = 1.0 + Math.pow(pClock / 1.8, 3) * 25.0;
          } else if (pPhase === 'imploding') {
            // Implosion - faster
            pScale = Math.max(0, 25.0 * (1 - pClock * 8));
          }

          const swirlSpeed = 20.0 + pScale * 8.0;
          const swirlPhase = time * swirlSpeed + i * 0.15;
          const swirlRadius = 0.35 * pScale;
          
          // Add some "jitter" to make it look unstable
          const jitter = (Math.random() - 0.5) * 0.05 * purpleWeight;
          const sX = Math.cos(swirlPhase) * swirlRadius + jitter;
          const sY = Math.sin(swirlPhase) * swirlRadius + jitter;
          const sZ = Math.sin(swirlPhase * 0.7) * swirlRadius + jitter;

          // Midpoint between hands
          const midX = (state.fingertipRed.x + state.fingertipBlue.x) / 2;
          const midY = (state.fingertipRed.y + state.fingertipBlue.y) / 2 + 0.15;
          const midZ = (state.fingertipRed.z + state.fingertipBlue.z) / 2;

          bx = bx * (1 - purpleWeight) + (midX + sX) * purpleWeight;
          by = by * (1 - purpleWeight) + (midY + sY) * purpleWeight;
          bz = bz * (1 - purpleWeight) + (midZ + sZ) * purpleWeight;
        }

        // Apply shockwave and distortion to all particles
        if (state.purpleShockwave > 0 || state.techBlendPurple > 0) {
          const midX = (state.fingertipRed.x + state.fingertipBlue.x) / 2;
          const midY = (state.fingertipRed.y + state.fingertipBlue.y) / 2 + 0.15;
          const midZ = (state.fingertipRed.z + state.fingertipBlue.z) / 2;
          
          const dx = bx - midX;
          const dy = by - midY;
          const dz = bz - midZ;
          const dSq = dx*dx + dy*dy + dz*dz;
          const dist = Math.sqrt(dSq) + 0.001;

          // Shockwave push
          if (state.purpleShockwave > 0) {
            const waveR = state.purpleClock * 40.0; // Rapidly expanding wave
            const waveDist = Math.abs(dist - waveR);
            if (waveDist < 2.0) {
              const push = (1.0 - waveDist / 2.0) * state.purpleShockwave * 5.0;
              bx += (dx / dist) * push;
              by += (dy / dist) * push;
              bz += (dz / dist) * push;
            }
          }

          // Environment Distortion (Lens effect)
          if (state.techBlendPurple > 0) {
            const distortionRadius = 5.0 * state.techBlendPurple;
            if (dist < distortionRadius) {
              const strength = (1.0 - dist / distortionRadius) * state.techBlendPurple * 0.4;
              const swirl = Math.sin(time * 10 + dist * 2) * strength;
              bx += (dy / dist) * swirl;
              by += (-dx / dist) * swirl;
            }
          }
        }
      } else if (state.activeDomain === 'gojo_red' && blendT > 0.8) {
        bx += state.fingertipRed.x; by += state.fingertipRed.y + 0.15; bz += state.fingertipRed.z;
      } else if (state.activeDomain === 'gojo_blue' && blendT > 0.8) {
        bx += state.fingertipBlue.x; by += state.fingertipBlue.y + 0.15; bz += state.fingertipBlue.z;
      }

      positions[i3] = bx;
      positions[i3 + 1] = by;
      positions[i3 + 2] = bz;

      // Colors
      let r, g, b;
      if (blendT >= 1) {
        r = tr; g = tg; b = tb;
      } else {
        r = idleCol[i3] + (tr - idleCol[i3]) * blendT;
        g = idleCol[i3 + 1] + (tg - idleCol[i3 + 1]) * blendT;
        b = idleCol[i3 + 2] + (tb - idleCol[i3 + 2]) * blendT;
      }

      if (isVoid) {
        const dr = userData.voidDistances[i];
        const shellR = 4.0;
        
        let pulseBoost = 0;
        if (pulse > 0 && state.domainState === DOMAIN_STATES.ACTIVE) {
          const band = Math.abs(dr - shellR);
          if (band < 0.7) {
            const bandFactor = 1 - band / 0.7;
            pulseBoost = bandFactor * pulse * 0.6;
          }
        }
        const interactionBoost = interaction * 0.55;
        const formedBoost = Math.max(0, blendT - 0.35) * 0.9;
        const boost = pulseBoost + interactionBoost + formedBoost;

        if (boost > 0) {
          const factor = 1 + boost;
          r *= factor;
          g *= 0.9 + boost * 0.1; // keep greens lower to stay in violet range
          b *= factor;
        }
      } else if (state.activeDomain === 'sukuna_shrine' && blendT > 0.8) {
        const shellR = 4.3;
        const distToCore = userData.shrineDistances[i];
        const band = Math.abs(distToCore - shellR);
        if (band < 0.8) {
          const factor = (0.8 - band) * pulse * 1.3 + interaction * 0.6;
          r += factor * 0.9;
          g += factor * 0.1;
          b += factor * 0.1;
        }
      }

      if (isPurple) {
        const flicker = 0.8 + Math.random() * 0.4;
        r *= flicker;
        g *= 0.2; // Keep green very low for deep purple
        b *= flicker;
        
        // Add a white-hot core boost
        if (i % 15 === 0) {
          r = 0.9; g = 0.8; b = 1.0;
        }
      }

      colors[i3] = Math.min(1, r);
      colors[i3 + 1] = Math.min(1, g);
      colors[i3 + 2] = Math.min(1, b);
    }

    particles.geometry.attributes.position.needsUpdate = true;
    particles.geometry.attributes.color.needsUpdate = true;

    // Update other objects
    if (particles) {
      if (state.activeDomain === 'gojo_void') {
        particles.material.opacity = 0.72 + blendT * 0.48 + state.pulseStrength * 0.22 + state.domainInteraction * 0.18;
        particles.material.size = 0.09 + blendT * 0.04 + state.pulseStrength * 0.012;
      } else if (state.activeDomain === 'gojo_red' || state.activeDomain === 'gojo_blue' || state.activeDomain === 'gojo_purple' || state.activeTechniques.red || state.activeTechniques.blue || state.activeTechniques.purple) {
        particles.material.size = state.activeTechniques.purple ? 0.15 : 0.09;
        particles.material.opacity = 0.95;
      } else {
        particles.material.size = state.activeDomain === 'sukuna_shrine' ? 0.12 : 0.12;
        particles.material.opacity = 0.8;
      }
    }

    if (coreSphereRef.current) {
      const isVoid = state.activeDomain === 'gojo_void';
      if (isVoid) {
        // Globe (core) should be visible during assembly and fade out immediately after formation.
        // It should NOT reappear during collapse.
        const showCore = (state.domainState === DOMAIN_STATES.ASSEMBLE) || 
                         (state.domainState === DOMAIN_STATES.ACTIVE && state.domainClock < 0.2);
        const coreTargetOpacity = showCore ? 0.9 * blendT : 0;
        
        coreSphereRef.current.visible = coreTargetOpacity > 0 || coreSphereRef.current.material.opacity > 0.01;
        coreSphereRef.current.material.opacity += (coreTargetOpacity - coreSphereRef.current.material.opacity) * Math.min(1, delta * 2);

        const baseScale = 1.0 + state.pulseStrength * 0.18 + state.domainInteraction * 0.08;
        coreSphereRef.current.scale.setScalar(baseScale);
        coreSphereRef.current.rotation.y += (0.12 + state.domainInteraction * 0.08) * delta;
        coreSphereRef.current.rotation.x = Math.sin(time * 0.3) * 0.08;
      } else {
        coreSphereRef.current.material.opacity = 0;
        coreSphereRef.current.visible = false;
      }
    }
    if (ringMeshRef.current) {
      const isVoid = state.activeDomain === 'gojo_void';
      if (isVoid) {
        // Globe (ring) should be visible during assembly and fade out immediately after formation.
        // It should NOT reappear during collapse.
        const showGlobe = (state.domainState === DOMAIN_STATES.ASSEMBLE) || 
                          (state.domainState === DOMAIN_STATES.ACTIVE && state.domainClock < 0.2);
        const ringTargetOpacity = showGlobe ? 0.85 * blendT : 0;
        
        ringMeshRef.current.visible = ringTargetOpacity > 0 || ringMeshRef.current.material.opacity > 0.01;
        ringMeshRef.current.material.opacity += (ringTargetOpacity - ringMeshRef.current.material.opacity) * Math.min(1, delta * 1.5);

        if (state.domainState !== DOMAIN_STATES.ACTIVE) {
          ringMeshRef.current.rotation.z += (0.18 + 0.6 * state.pulseStrength + 0.4 * state.domainInteraction) * delta;
        }
        ringMeshRef.current.rotation.x = Math.sin(time * 0.15) * 0.12;
        ringMeshRef.current.rotation.y = Math.cos(time * 0.11) * 0.07;
      } else {
        ringMeshRef.current.material.opacity = 0;
        ringMeshRef.current.visible = false;
      }
    }
    if (waterMeshRef.current) {
      const waterWave = Math.sin(Date.now() * 0.002) * 0.35;
      const idleLerp = Math.max(0, Math.min(1, blendT));
      const isShrine = state.activeDomain === 'sukuna_shrine';
      waterMeshRef.current.visible = isShrine && blendT > 0;
      waterMeshRef.current.material.opacity = isShrine ? 0.25 + idleLerp * 0.65 : 0;
      waterMeshRef.current.position.y = -3.2 + (isShrine ? waterWave * 0.1 : 0);
    }

    if (bloomPassRef.current) {
      if (state.activeTechniques.purple) {
        const pW = state.techBlendPurple;
        const pPhase = state.purplePhase;
        let pBoost = 0;
        if (pPhase === 'active') pBoost = 2.5;
        if (pPhase === 'imploding') pBoost = 4.0;
        
        bloomPassRef.current.strength = 2.0 + pW * 3.0 + pBoost;
        bloomPassRef.current.radius = 0.5 + pW * 0.5;
      } else if (state.activeDomain === 'gojo_void') {
        const baseBloom = 1.35 + blendT * 0.85;
        bloomPassRef.current.strength = baseBloom + state.pulseStrength * 1.15 + state.domainInteraction * 0.8;
        bloomPassRef.current.radius = 0.48 + 0.18 * state.pulseStrength;
      } else {
        const baseBloom = 1.6 + blendT * 0.8;
        bloomPassRef.current.strength = baseBloom + state.pulseStrength * 1.4 + state.domainInteraction * 0.8;
        bloomPassRef.current.radius = 0.45 + blendT * 0.25;
      }
    }
  };

  // --- Hand Tracking Logic ---

  const onHandResults = (results: Results) => {
    if (!handCanvasRef.current) return;
    const canvas = handCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Removed manual flip because selfieMode: true handles it

    if (results.multiHandLandmarks) {
      for (const landmarks of results.multiHandLandmarks) {
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: 'rgba(255,255,255,0.3)', lineWidth: 2 });
        drawLandmarks(ctx, landmarks, { color: 'rgba(255,255,255,0.8)', lineWidth: 1, radius: 3 });
      }
      
      // Draw Hollow Purple Ready Cue
      const state = stateRef.current;
      if (state.purpleProximity > 0 && results.multiHandLandmarks.length === 2) {
        const proximity = state.purpleProximity;
        const pulse = Math.sin(Date.now() * 0.01) * 0.5 + 0.5;
        const intensity = proximity * (0.6 + pulse * 0.4);
        
        // Find index finger tips
        const landmarks = results.multiHandLandmarks;
        const handedness = results.multiHandedness;
        
        let redTip = null;
        let blueTip = null;
        
        for (let i = 0; i < landmarks.length; i++) {
          if (handedness[i].label === 'Right') redTip = landmarks[i][8];
          if (handedness[i].label === 'Left') blueTip = landmarks[i][8];
        }
        
        if (redTip && blueTip) {
          const rX = redTip.x * canvas.width;
          const rY = redTip.y * canvas.height;
          const bX = blueTip.x * canvas.width;
          const bY = blueTip.y * canvas.height;
          
          // Draw glows at fingertips
          const drawGlow = (x: number, y: number, color: string) => {
            const grad = ctx.createRadialGradient(x, y, 0, x, y, 40 * intensity);
            grad.addColorStop(0, color);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, 40 * intensity, 0, Math.PI * 2);
            ctx.fill();
          };
          
          drawGlow(rX, rY, `rgba(255, 50, 50, ${0.8 * intensity})`);
          drawGlow(bX, bY, `rgba(50, 150, 255, ${0.8 * intensity})`);
          
          // Draw connecting arc/lightning
          ctx.beginPath();
          ctx.moveTo(rX, rY);
          ctx.lineTo(bX, bY);
          ctx.strokeStyle = `rgba(200, 100, 255, ${0.5 * intensity})`;
          ctx.lineWidth = 2 * intensity;
          ctx.stroke();
          
          // Add some "sparks"
          if (Math.random() < 0.3) {
            const midX = (rX + bX) / 2 + (Math.random() - 0.5) * 20;
            const midY = (rY + bY) / 2 + (Math.random() - 0.5) * 20;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(midX, midY, 1 + Math.random() * 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      
      detectGestures(results);
    } else {
      handleNoHands();
    }
    ctx.restore();
  };

  const detectGestures = (results: Results) => {
    const state = stateRef.current;
    const now = performance.now();
    const dt = state.lastHandTime > 0 ? (now - state.lastHandTime) / 1000 : 0.016;
    state.lastHandTime = now;

    const landmarks = results.multiHandLandmarks;
    const handedness = results.multiHandedness;

    let gojoVoidDetected = false;
    let gojoRedDetected = false;
    let gojoBlueDetected = false;
    let sukunaShrineDetected = false;

    // 1. Detect Sukuna Shrine Sign first (Two hands mudra)
    // Disable Sukuna detection if Gojo's techniques are active to prevent accidental triggers during Hollow Purple
    // Also check for Hollow Purple cooldown
    const gojoActive = state.activeTechniques.red || state.activeTechniques.blue || state.activeTechniques.purple;
    const inCooldown = state.purpleCooldown > 0;
    
    if (!inCooldown && !gojoActive && landmarks.length === 2 && handedness) {
      const leftIdx = handedness.findIndex(h => h.label === 'Left');
      const rightIdx = handedness.findIndex(h => h.label === 'Right');
      if (leftIdx !== -1 && rightIdx !== -1) {
        if (classifySukunaShrine(landmarks[leftIdx], landmarks[rightIdx])) {
          sukunaShrineDetected = true;
        }
      }
    }

    // 2. Detect single hand gestures
    if (landmarks.length >= 1 && handedness) {
      // Check if hands are close to each other (likely a two-handed gesture)
      let handsClose = false;
      if (landmarks.length === 2) {
        const dSq = (a: any, b: any) => (a.x - b.x)**2 + (a.y - b.y)**2;
        // Distance between middle finger bases
        const d = dSq(landmarks[0][9], landmarks[1][9]);
        if (d < 0.08) handsClose = true; 
      }

      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const label = handedness[i].label; // 'Left' or 'Right'
        
        // ALWAYS update fingertip positions if hand is seen for maximum responsiveness
        if (label === 'Right') updateFingertipWorld(lm, dt, 'red');
        if (label === 'Left') updateFingertipWorld(lm, dt, 'blue');

        if (classifyGojoVoid(lm)) gojoVoidDetected = true;
        
        // Only detect Red/Blue if Sukuna is NOT detected and hands are NOT close
        // This prevents accidental triggers during the Sukuna mudra formation
        if (!inCooldown && !sukunaShrineDetected && !handsClose && classifyGojoRed(lm)) {
          if (label === 'Right') {
            gojoRedDetected = true;
          } else if (label === 'Left') {
            gojoBlueDetected = true;
          }
        }
      }
    }

    if (gojoVoidDetected && !inCooldown) gojoVoidDetected = true;
    else gojoVoidDetected = false;

    // Handle detection counts
    updateGestureProgress('gojo_void', gojoVoidDetected);
    updateGestureProgress('gojo_red', gojoRedDetected);
    updateGestureProgress('gojo_blue', gojoBlueDetected);
    updateGestureProgress('sukuna_shrine', sukunaShrineDetected);

    // Update interaction level for Gojo Void
    if (state.activeDomain === 'gojo_void' && (state.domainState === DOMAIN_STATES.ACTIVE || state.domainState === DOMAIN_STATES.ASSEMBLE)) {
      if (gojoVoidDetected) {
        state.domainInteraction = Math.min(state.domainInteraction + 0.05, 1);
      } else {
        state.domainInteraction = Math.max(state.domainInteraction - 0.03, 0);
      }
    } else {
      state.domainInteraction = Math.max(state.domainInteraction - 0.03, 0);
    }

    const sign = gojoVoidDetected ? 'Unlimited Void' : 
                 state.activeTechniques.purple ? 'Hollow Purple' :
                 (state.activeTechniques.red && state.activeTechniques.blue) ? 'Red & Blue' :
                 state.activeTechniques.red ? 'Reversal Red' : 
                 state.activeTechniques.blue ? 'Lapse Blue' :
                 sukunaShrineDetected ? 'Malevolent Shrine' : null;
    setDetectedSign(sign);
    setActivePill(sign);
  };



  const handleNoHands = () => {
    const state = stateRef.current;
    updateGestureProgress('gojo_void', false);
    updateGestureProgress('gojo_red', false);
    updateGestureProgress('gojo_blue', false);
    updateGestureProgress('sukuna_shrine', false);
    setDetectedSign(null);
    setActivePill(null);
  };

  const updateGestureProgress = (domain: ActiveDomain, detected: boolean) => {
    if (!domain) return;
    const state = stateRef.current;
    
    // Thresholds
    const HOLD_FRAMES = 6; 
    const LOST_FRAMES = domain === 'gojo_void' ? 60 : 8; 

    const isTechnique = domain === 'gojo_red' || domain === 'gojo_blue';

    // Hollow Purple Proximity Check
    const purpleThreshold = 0.35; // Increased threshold for easier triggering
    const readyThreshold = 0.75;  // Distance at which the "ready" cue starts appearing
    const distSq = (a: THREE.Vector3, b: THREE.Vector3) => (a.x - b.x)**2 + (a.y - b.y)**2 + (a.z - b.z)**2;
    const currentDistSq = distSq(state.fingertipRed, state.fingertipBlue);
    const handsClose = currentDistSq < purpleThreshold**2;
    const bothActive = state.activeTechniques.red && state.activeTechniques.blue;

    // Update proximity for visual cues
    if (bothActive && currentDistSq < readyThreshold**2) {
      const dist = Math.sqrt(currentDistSq);
      // Map distance [purpleThreshold, readyThreshold] to [1, 0]
      state.purpleProximity = Math.max(0, Math.min(1, (readyThreshold - dist) / (readyThreshold - purpleThreshold)));
      if (!isPurpleReady) setIsPurpleReady(true);
    } else {
      state.purpleProximity = 0;
      if (isPurpleReady) setIsPurpleReady(false);
    }

    if (bothActive && handsClose && state.purplePhase === 'none') {
      state.purplePhase = 'forming';
      state.purpleClock = 0;
      state.activeTechniques.purple = true;
      setShowCinematicText(true);
      // Increased duration to 7 seconds for better readability
      setTimeout(() => setShowCinematicText(false), 7000);
      playDomainAudio('gojo_purple');
    }

    if (detected) {
      state.lostCounts[domain] = 0;
      
      if (isTechnique) {
        state.holdCounts[domain]++;
        if (state.holdCounts[domain] >= HOLD_FRAMES) {
          const techKey = domain === 'gojo_red' ? 'red' : 'blue';
          if (!state.activeTechniques[techKey]) {
            state.activeTechniques[techKey] = true;
            setShowCinematicText(true);
            setTimeout(() => setShowCinematicText(false), 4000);
            playDomainAudio(domain);
          }
          state.holdCounts[domain] = HOLD_FRAMES;
        }
      } else if (state.activeDomain === null) {
        state.holdCounts[domain]++;
        setGestureProgress(Math.min(state.holdCounts[domain] / HOLD_FRAMES, 1));
        if (state.holdCounts[domain] >= HOLD_FRAMES) {
          activateDomain(domain);
          state.holdCounts[domain] = 0;
          setGestureProgress(0);
        }
      } else if (state.activeDomain === domain) {
        state.lostCounts[domain] = 0;
      }
    } else {
      state.holdCounts[domain] = Math.max(0, state.holdCounts[domain] - 1);
      
      if (isTechnique) {
        state.lostCounts[domain]++;
        if (state.lostCounts[domain] >= LOST_FRAMES) {
          const techKey = domain === 'gojo_red' ? 'red' : 'blue';
          state.activeTechniques[techKey] = false;
          state.lostCounts[domain] = 0;
        }
      } else {
        if (state.activeDomain === null) {
          setGestureProgress(prev => prev > 0.01 ? prev * 0.8 : 0);
        }
        
        if (state.activeDomain === domain) {
          state.lostCounts[domain]++;
          if (state.lostCounts[domain] >= LOST_FRAMES) {
            deactivateDomain();
            state.lostCounts[domain] = 0;
          }
        }
      }
    }

    // Update tech blends independently of the detection logic above
    const appearSpeed = 0.012; // Slower, more weighted formation
    const disappearSpeed = 0.08; // Snappy dissipation when hand is released
    
    if (state.activeTechniques.red) state.techBlendRed = Math.min(1, state.techBlendRed + appearSpeed);
    else state.techBlendRed = Math.max(0, state.techBlendRed - disappearSpeed);

    if (state.activeTechniques.blue) state.techBlendBlue = Math.min(1, state.techBlendBlue + appearSpeed);
    else state.techBlendBlue = Math.max(0, state.techBlendBlue - disappearSpeed);

    // Hollow Purple Phase Management
    if (state.activeTechniques.purple) {
      state.purpleClock += 0.016; // Approx delta
      if (state.purplePhase === 'forming') {
        state.techBlendPurple = Math.min(1, state.techBlendPurple + 0.015);
        if (state.techBlendPurple >= 1 && state.purpleClock > 1.2) {
          state.purplePhase = 'active';
          state.purpleClock = 0;
          setFlashActive(true);
          setTimeout(() => setFlashActive(false), 150);
        }
      } else if (state.purplePhase === 'active') {
        if (state.purpleClock > 1.8) {
          state.purplePhase = 'imploding';
          state.purpleClock = 0;
          setFlashActive(true);
          setTimeout(() => setFlashActive(false), 250);
          state.purpleShockwave = 1.0;
        }
      } else if (state.purplePhase === 'imploding') {
        state.techBlendPurple = Math.max(0, state.techBlendPurple - 0.08);
        state.purpleShockwave = Math.max(0, state.purpleShockwave - 0.04);
        if (state.techBlendPurple <= 0) {
          state.activeTechniques.purple = false;
          state.purplePhase = 'none';
          state.purpleCooldown = 2.0; // 2 second cooldown after Hollow Purple
          state.activeTechniques.red = false;
          state.activeTechniques.blue = false;
          state.purpleShockwave = 0;
        }
      }
    } else {
      state.techBlendPurple = Math.max(0, state.techBlendPurple - 0.1);
      state.purpleShockwave = Math.max(0, state.purpleShockwave - 0.05);
    }

    // Update hold instruction visibility
    const isAnyHolding = state.holdCounts.gojo_void > 0 || 
                         state.holdCounts.sukuna_shrine > 0 || 
                         state.holdCounts.gojo_red > 0 || 
                         state.holdCounts.gojo_blue > 0;
    
    const isAnyActive = state.activeDomain !== null || 
                        state.activeTechniques.red || 
                        state.activeTechniques.blue || 
                        state.activeTechniques.purple;

    if (isAnyHolding && !isAnyActive) {
      if (!showHoldInstruction) setShowHoldInstruction(true);
    } else {
      if (showHoldInstruction) setShowHoldInstruction(false);
    }
  };

  const activateDomain = (domain: ActiveDomain) => {
    const state = stateRef.current;
    state.activeDomain = domain;
    state.domainState = DOMAIN_STATES.CHARGE;
    state.domainClock = 0;
    state.lastPulseTime = 0;
    
    const names = {
      gojo_void: 'Unlimited Void',
      gojo_red: 'Reversal Red',
      gojo_blue: 'Lapse Blue',
      sukuna_shrine: 'Malevolent Shrine'
    };
    setCurrentDomainName(names[domain as keyof typeof names] || '—');
    
    // Cinematic effects
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 100);
    
    setShowCinematicText(true);
    setTimeout(() => setShowCinematicText(false), 5000);

    if (domain === 'gojo_void') {
      setDomainShock(true);
      setTimeout(() => setDomainShock(false), 1200);
      triggerCrack();
      setTimeout(() => {
        startKanjiRain();
        startRays();
      }, 900);
    }

    // Play Audio
    playDomainAudio(domain);
  };

  const deactivateDomain = () => {
    const state = stateRef.current;
    if (state.domainState === DOMAIN_STATES.IDLE || state.domainState === DOMAIN_STATES.COLLAPSE) return;
    state.domainState = DOMAIN_STATES.COLLAPSE;
    state.domainClock = 0;

    if (state.activeDomain === 'gojo_void') {
      stopKanjiRain();
      stopRays();
    }
  };

  const pauseBgmForVoicePlayback = () => {
    const bgm = bgmRef.current;
    if (!bgm) return;

    const pauseState = bgmPauseStateRef.current;
    if (pauseState.pausedForVoice) return;

    pauseState.time = bgm.currentTime;
    pauseState.shouldResume = !bgm.paused;
    pauseState.pausedForVoice = true;

    if (!bgm.paused) {
      bgm.pause();
    }
  };

  const resumeBgmFromPausePoint = (playbackId: number) => {
    if (voicePlaybackIdRef.current !== playbackId) return;

    const bgm = bgmRef.current;
    const pauseState = bgmPauseStateRef.current;

    voicePlaybackIdRef.current = 0;

    if (!pauseState.pausedForVoice) return;

    const resumeTime = pauseState.time;
    const shouldResume = pauseState.shouldResume;

    pauseState.time = 0;
    pauseState.shouldResume = false;
    pauseState.pausedForVoice = false;

    if (!bgm || !shouldResume) return;

    bgm.currentTime = resumeTime;
    bgm.play().catch((error) => console.error('BGM resume failed:', error));
  };

  const playDomainAudio = (domain: ActiveDomain) => {
    if (domain !== 'gojo_void' && domain !== 'sukuna_shrine') return;

    const voice = voiceRef.current;
    if (!voice) return;

    const voiceLine = DOMAIN_VOICE_LINES[domain][voiceLanguageRef.current];
    const playbackId = voicePlaybackIdRef.current + 1;
    voicePlaybackIdRef.current = playbackId;

    voice.pause();
    voice.currentTime = 0;
    voice.onended = null;
    voice.onerror = null;

    pauseBgmForVoicePlayback();

    voice.src = voiceLine;
    voice.muted = isMuted;
    voice.onended = () => resumeBgmFromPausePoint(playbackId);
    voice.onerror = () => {
      console.error(`Voice line failed to load: ${voiceLine}`);
      resumeBgmFromPausePoint(playbackId);
    };

    voice.play().catch((error) => {
      console.error(`Voice line playback failed: ${voiceLine}`, error);
      resumeBgmFromPausePoint(playbackId);
    });
  };

  // --- Gesture Classifiers ---

  const classifyGojoVoid = (lm: any) => {
    const distSq = (a: any, b: any) => (a.x - b.x)**2 + (a.y - b.y)**2;
    
    // Calculate hand scale squared
    const handScaleSq = distSq(lm[0], lm[9]);
    if (handScaleSq < 0.0001) return false;

    // Gojo's sign: Index and Middle fingers crossed
    const indexUp = lm[8].y < lm[5].y - 0.1;
    const middleUp = lm[12].y < lm[9].y - 0.1;
    
    // Folded fingers
    const ringFolded = lm[16].y > lm[14].y - 0.05;
    const pinkyFolded = lm[20].y > lm[18].y - 0.05;
    
    // Tips close (crossed)
    const tipsClose = distSq(lm[8], lm[12]) < handScaleSq * 0.25;
    
    // Upright
    const upright = lm[0].y > lm[9].y;

    return indexUp && middleUp && ringFolded && pinkyFolded && tipsClose && upright;
  };

  const classifyGojoRed = (lm: any) => {
    const distSq = (a: any, b: any) => (a.x - b.x)**2 + (a.y - b.y)**2;
    const handScaleSq = distSq(lm[0], lm[9]);
    if (handScaleSq < 0.0001) return false;

    const indexUp = lm[8].y < lm[5].y - 0.15;
    const middleDown = lm[12].y > lm[10].y;
    const ringDown = lm[16].y > lm[14].y;
    const pinkyDown = lm[20].y > lm[18].y;
    
    // Thumb should be tucked or pointing towards index
    const thumbTucked = distSq(lm[4], lm[5]) < handScaleSq * 0.4;
    
    return indexUp && middleDown && ringDown && pinkyDown && thumbTucked;
  };

  const classifySukunaShrine = (left: any, right: any) => {
    const distSq = (a: any, b: any) => (a.x - b.x)**2 + (a.y - b.y)**2 + (a.z - b.z)**2;
    
    const leftScaleSq = distSq(left[0], left[9]);
    const rightScaleSq = distSq(right[0], right[9]);
    const avgScaleSq = (leftScaleSq + rightScaleSq) / 2;
    if (avgScaleSq < 0.0001) return false;

    // Index tips and thumb tips should be touching or very close
    const indexClose = distSq(left[8], right[8]) < avgScaleSq * 0.4;
    const thumbClose = distSq(left[4], right[4]) < avgScaleSq * 0.4;
    
    const isFolded = (hand: any) => {
      return hand[12].y > hand[10].y && 
             hand[16].y > hand[14].y && 
             hand[20].y > hand[18].y;
    };
    
    // Hands should be roughly at the same height and upright
    const vertical = (left[8].y + right[8].y) / 2 < (left[0].y + right[0].y) / 2 - 0.05;
    
    return indexClose && thumbClose && isFolded(left) && isFolded(right) && vertical;
  };

  const updateFingertipWorld = (lm: any, dt: number, target: 'red' | 'blue' | 'general' = 'general') => {
    if (!cameraRef.current) return;
    const state = stateRef.current;
    const tip = lm[8];
    const x = tip.x * 2 - 1;
    const y = (1 - tip.y) * 2 - 1;
    const vector = new THREE.Vector3(x, y, 0.5);
    vector.unproject(cameraRef.current);
    const dir = vector.sub(cameraRef.current.position).normalize();
    const distance = -cameraRef.current.position.z / dir.z;
    const rawPos = cameraRef.current.position.clone().add(dir.multiplyScalar(distance));
    
    let currentPos: THREE.Vector3;
    let currentVel: THREE.Vector3;
    
    if (target === 'red') {
      currentPos = state.fingertipRed;
      currentVel = state.fingertipRedVel;
    } else if (target === 'blue') {
      currentPos = state.fingertipBlue;
      currentVel = state.fingertipBlueVel;
    } else {
      currentPos = state.fingertipWorld;
      currentVel = new THREE.Vector3(); // Dummy
    }

    if (dt > 0 && dt < 0.2) {
      // Calculate velocity for prediction
      const newVel = rawPos.clone().sub(currentPos).divideScalar(dt);
      currentVel.lerp(newVel, 0.4); // Smooth velocity tracking
      
      // Prediction: Compensate for ~60ms of total latency (camera + processing + render)
      const predictionTime = 0.06;
      const predictedPos = rawPos.clone().add(currentVel.clone().multiplyScalar(predictionTime));
      
      // Adaptive smoothing: more responsive when moving fast, more stable when still
      const speed = currentVel.length();
      const lerpFactor = Math.min(0.98, 0.75 + speed * 0.15);
      currentPos.lerp(predictedPos, lerpFactor);
    } else {
      currentPos.copy(rawPos);
    }
  };

  const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // --- Gojo Unlimited Void Specific Effects ---

  const triggerCrack = () => {
    setShowCracks(true);
    setTimeout(() => setShowCracks(false), 1600);
  };

  const startKanjiRain = () => {
    if (!kanjiCanvasRef.current) return;
    const canvas = kanjiCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width = window.innerWidth;
    const H = canvas.height = window.innerHeight;
    const symbols = '無量空処∞術式展開六眼五条悟虚茈赫閃蒼断絶覇零神∮∯∰∇∆⊕⊗⊘∅∃∀⊂⊃αβγδεζ'.split('');
    
    kanjiRainStateRef.current.running = true;

    // Phase 1: Burst
    const particles: any[] = Array.from({ length: 60 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 9;
      return {
        x: W / 2, y: H / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        char: symbols[Math.floor(Math.random() * symbols.length)],
        alpha: 0.9 + Math.random() * 0.1,
        size: 10 + Math.random() * 18,
        life: 0.6 + Math.random() * 0.4,
        age: 0,
        decay: 0.012 + Math.random() * 0.01
      };
    });

    let start: number | null = null;
    const frame = (ts: number) => {
      if (!start) start = ts;
      ctx.clearRect(0, 0, W, H);
      const elapsed = (ts - start) / 1000;
      let alive = 0;
      ctx.textAlign = 'center';

      // Shockwave ring from HTML
      const ringR = elapsed * 900;
      if (ringR < Math.max(W, H) * 1.4) {
        const ringGrad = ctx.createRadialGradient(W / 2, H / 2, ringR * 0.85, W / 2, H / 2, ringR);
        ringGrad.addColorStop(0, 'rgba(160,216,239,0)');
        ringGrad.addColorStop(0.5, `rgba(200,235,255,${Math.max(0, 0.12 - elapsed * 0.1)})`);
        ringGrad.addColorStop(1, 'rgba(160,216,239,0)');
        ctx.fillStyle = ringGrad;
        ctx.fillRect(0, 0, W, H);
      }

      for (const p of particles) {
        p.age += p.decay;
        if (p.age >= p.life) continue;
        alive++;
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.97; p.vy *= 0.97;
        const t = p.age / p.life;
        const a = p.alpha * (1 - Math.pow(t, 1.6));
        
        // White-hot near centre, ice blue at edges from HTML
        const dist = Math.hypot(p.x - W / 2, p.y - H / 2);
        const maxDist = Math.max(W, H) * 0.7;
        const blue = Math.min(1, dist / maxDist);
        const r = Math.round(200 + (1 - blue) * 55);
        const g = Math.round(220 + (1 - blue) * 35);
        const b = 255;

        ctx.font = `${p.size}px "Noto Serif JP", serif`;
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.fillText(p.char, p.x, p.y);
      }

      if (alive > 0 || elapsed < 0.8) {
        kanjiRainStateRef.current.phaseRAF = requestAnimationFrame(frame);
      } else {
        startOverload();
      }
    };

    const startOverload = () => {
      const clusters: any[] = [];
      let last = 0;
      const overloadFrame = (ts: number) => {
        if (!kanjiRainStateRef.current.running) return;
        const dt = (ts - last) / 1000;
        last = ts;
        ctx.clearRect(0, 0, W, H);
        ctx.textAlign = 'center';

        if (Math.random() < 0.08 && clusters.length < 8) {
          clusters.push({
            x: Math.random() * W, y: Math.random() * H,
            chars: Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => ({
              dx: (Math.random() - 0.5) * 120, dy: (Math.random() - 0.5) * 80,
              char: symbols[Math.floor(Math.random() * symbols.length)],
              size: 9 + Math.random() * 12
            })),
            age: 0, life: 1.8 + Math.random() * 1.4
          });
        }

        for (let i = clusters.length - 1; i >= 0; i--) {
          const cl = clusters[i];
          cl.age += dt;
          if (cl.age > cl.life) { clusters.splice(i, 1); continue; }
          const t = cl.age / cl.life;
          const env = t < 0.25 ? t / 0.25 : t > 0.75 ? (1 - t) / 0.25 : 1;
          for (const ch of cl.chars) {
            ctx.font = `${ch.size}px "Noto Serif JP", serif`;
            ctx.fillStyle = `rgba(180, 225, 255, ${0.1 * env})`;
            ctx.fillText(ch.char, cl.x + ch.dx, cl.y + ch.dy);
          }
        }
        kanjiRainStateRef.current.overloadRAF = requestAnimationFrame(overloadFrame);
      };
      kanjiRainStateRef.current.overloadRAF = requestAnimationFrame(overloadFrame);
    };

    kanjiRainStateRef.current.phaseRAF = requestAnimationFrame(frame);
  };

  const stopKanjiRain = () => {
    kanjiRainStateRef.current.running = false;
    cancelAnimationFrame(kanjiRainStateRef.current.phaseRAF);
    cancelAnimationFrame(kanjiRainStateRef.current.overloadRAF);
    const canvas = kanjiCanvasRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const startRays = () => {
    if (!raysCanvasRef.current) return;
    const canvas = raysCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    raysStateRef.current.running = true;

    const frame = () => {
      if (!raysStateRef.current.running) return;
      raysStateRef.current.angle += 0.0015;
      ctx.clearRect(0, 0, 1400, 1400);
      const cx = 700, cy = 700;
      const numRays = 18; // Reduced from 28
      for (let i = 0; i < numRays; i++) {
        const angle = (i / numRays) * Math.PI * 2 + raysStateRef.current.angle;
        const spread = (Math.PI / numRays) * (0.3 + Math.random() * 0.4);
        const len = 600 + Math.random() * 100;
        const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
        grad.addColorStop(0, `rgba(200,235,255,0.18)`);
        grad.addColorStop(0.4, `rgba(160,216,239,0.08)`);
        grad.addColorStop(1, 'rgba(160,216,239,0)');
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle - spread) * len, cy + Math.sin(angle - spread) * len);
        ctx.lineTo(cx + Math.cos(angle + spread) * len, cy + Math.sin(angle + spread) * len);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }
      raysStateRef.current.raf = requestAnimationFrame(frame);
    };
    raysStateRef.current.raf = requestAnimationFrame(frame);
  };

  const stopRays = () => {
    raysStateRef.current.running = false;
    cancelAnimationFrame(raysStateRef.current.raf);
  };

  // --- UI Handlers ---

  const handleEnter = () => {
    setShowIntro(false);
    setIsInitialized(true);
    if (bgmRef.current) {
      bgmRef.current.play().catch(e => console.error("Audio play failed:", e));
    }
  };


  const getCinematicContent = () => {
    const state = stateRef.current;
    if (state.activeDomain === 'gojo_void') {
      return { jp: '無量空処', en: 'Unlimited Void', sub: '― infinite knowledge, infinite nothing ―' };
    }
    if (state.activeDomain === 'sukuna_shrine') {
      return { jp: '伏魔御厨子', en: 'Malevolent Shrine', sub: 'cleave • dismantle • inevitable slaughter' };
    }
    
    const isRed = state.activeDomain === 'gojo_red' || state.activeTechniques.red;
    const isBlue = state.activeDomain === 'gojo_blue' || state.activeTechniques.blue;
    const isPurple = state.activeTechniques.purple;
    
    if (isPurple) {
      return { jp: '虚式「茈」', en: 'HOLLOW PURPLE', sub: 'imaginary mass • collapse of infinity' };
    }
    if (isRed && isBlue) {
      return { jp: '術式反転「赫」 • 術式順転「蒼」', en: 'RED • BLUE', sub: 'convergence & divergence of infinity' };
    }
    if (isRed) {
      return { jp: '術式反転 「赫」', en: 'Reversal Red', sub: 'convergence of infinity' };
    }
    if (isBlue) {
      return { jp: '術式順転「蒼」', en: 'LAPSE: BLUE', sub: 'divergence of infinity' };
    }
    return null;
  };

  return (
    <div className={`relative w-full h-screen bg-black overflow-hidden font-sans text-white ${
      (stateRef.current.activeDomain === 'sukuna_shrine' && stateRef.current.domainState === DOMAIN_STATES.ACTIVE) ||
      (stateRef.current.activeTechniques.purple && stateRef.current.purplePhase !== 'none') ? 'animate-shake' : ''
    }`}>
      {/* Gojo Specific Overlays */}
      <div 
        ref={crackOverlayRef}
        className={`fixed inset-0 z-[999] pointer-events-none transition-opacity duration-[1600ms] ${showCracks ? 'opacity-100' : 'opacity-0'}`}
      >
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          {[
            { x2: 760, y2: 180 }, { x2: 1200, y2: 150 }, { x2: 1380, y2: 430 },
            { x2: 1450, y2: 700 }, { x2: 1100, y2: 920 }, { x2: 700, y2: 980 },
            { x2: 480, y2: 820 }, { x2: 340, y2: 600 }, { x2: 420, y2: 280 },
            { x2: 640, y2: 60 }, { x2: 960, y2: 0 }, { x2: 1600, y2: 250 }
          ].map((line, i) => (
            <line 
              key={i}
              className={`crack-line stroke-[rgba(200,235,255,0.85)] stroke-[1.5] fill-none [stroke-dasharray:500] [stroke-dashoffset:500] [filter:drop-shadow(0_0_4px_#a0d8ef)] ${showCracks ? 'animate-crack-in' : ''}`}
              style={{ animationDelay: `${i * 35}ms` }}
              x1="960" y1="540" x2={line.x2} y2={line.y2} 
            />
          ))}
        </svg>
      </div>

      <canvas ref={kanjiCanvasRef} className="fixed inset-0 z-15 pointer-events-none" />
      
      <div className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 z-12 pointer-events-none transition-opacity duration-2000 ${stateRef.current.activeDomain === 'gojo_void' ? 'opacity-100' : 'opacity-0'}`}>
        <canvas ref={raysCanvasRef} width="1400" height="1400" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>

      {/* Flash Effect */}
      <AnimatePresence>
        {flashActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-[1000] pointer-events-none ${
              stateRef.current.activeTechniques.purple ? 'bg-purple-500/60' :
              stateRef.current.activeDomain === 'sukuna_shrine' ? 'bg-red-500/80' : 
              stateRef.current.activeDomain === 'gojo_void' ? 'bg-blue-100/90' : 'bg-white'
            }`}
          />
        )}
      </AnimatePresence>

      {/* Vignette */}
      <div 
        className="fixed inset-0 z-50 pointer-events-none transition-opacity duration-1000"
        style={{ 
          opacity: stateRef.current.domainState === DOMAIN_STATES.ACTIVE || stateRef.current.activeTechniques.purple ? 1 : 0,
          background: stateRef.current.activeTechniques.purple
            ? 'radial-gradient(ellipse at center, transparent 15%, rgba(40, 0, 60, 0.4) 50%, rgba(20, 0, 40, 0.9) 100%)'
            : stateRef.current.activeDomain === 'sukuna_shrine' 
            ? 'radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 10%, rgba(0, 0, 0, 0.88) 75%, #000 100%)'
            : stateRef.current.activeDomain === 'gojo_void'
            ? 'radial-gradient(ellipse at center, transparent 15%, rgba(0, 15, 35, 0.6) 50%, rgba(0, 5, 15, 0.95) 100%)'
            : 'radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 20%, rgba(0, 0, 0, 0.7) 80%, #000 100%)'
        }}
      />

      {/* Cinematic Text Overlay */}
      <AnimatePresence>
        {showCinematicText && (
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.7, ease: [0.16, 1, 0.3, 1] }}
            className={`fixed inset-0 z-[200] flex flex-col items-center justify-center pointer-events-none text-center ${
              stateRef.current.activeTechniques.purple ? '-translate-y-32' : ''
            }`}
          >
            {stateRef.current.activeTechniques.purple && (
              <div className="absolute inset-x-0 h-64 bg-black/40 blur-3xl -z-10" />
            )}
            <div className={`text-[clamp(38px,7vw,82px)] tracking-[0.5em] font-bold font-serif ${
              stateRef.current.activeTechniques.purple
                ? 'text-purple-400 animate-void-glow drop-shadow-[0_0_35px_rgba(160,80,255,1)]'
                : stateRef.current.activeDomain === 'gojo_void' || (stateRef.current.activeTechniques.blue && !stateRef.current.activeTechniques.red) 
                ? 'text-blue-300 animate-void-glow drop-shadow-[0_0_25px_rgba(80,180,255,1)]' 
                : stateRef.current.activeDomain === 'sukuna_shrine'
                ? 'text-[#ff2200] [text-shadow:0_0_90px_rgba(255,0,0,1)] drop-shadow-[0_0_25px_rgba(255,0,0,1)]'
                : (stateRef.current.activeTechniques.red && stateRef.current.activeTechniques.blue)
                ? 'bg-gradient-to-r from-[#ff4422] to-[#00aaff] bg-clip-text text-transparent drop-shadow-[0_0_25px_rgba(255,255,255,0.5)]'
                : 'text-[#ff4422] [text-shadow:0_0_90px_rgba(120,0,0,0.9)] drop-shadow-[0_0_25px_rgba(255,80,80,1)]'
            }`}>
              {getCinematicContent()?.jp}
            </div>
            <div className={`mt-4 text-2xl tracking-[0.4em] uppercase font-bold ${
              stateRef.current.activeTechniques.purple
                ? 'bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent'
                : stateRef.current.activeDomain === 'gojo_void' || (stateRef.current.activeTechniques.blue && !stateRef.current.activeTechniques.red)
                ? 'text-blue-200/90' 
                : stateRef.current.activeDomain === 'sukuna_shrine'
                ? 'text-red-500'
                : (stateRef.current.activeTechniques.red && stateRef.current.activeTechniques.blue)
                ? 'bg-gradient-to-r from-[#ff4422] to-[#00aaff] bg-clip-text text-transparent'
                : 'text-red-100/90'
            }`}>
              {getCinematicContent()?.en}
            </div>
            <div className={`mt-2 text-sm tracking-[0.3em] ${
              stateRef.current.activeTechniques.purple
                ? 'text-purple-200/70'
                : stateRef.current.activeDomain === 'gojo_void' || (stateRef.current.activeTechniques.blue && !stateRef.current.activeTechniques.red)
                ? 'text-blue-200/70' 
                : stateRef.current.activeDomain === 'sukuna_shrine'
                ? 'text-red-400/80'
                : 'text-red-200/70'
            }`}>
              {getCinematicContent()?.sub}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Elements */}
      <video
        ref={videoRef}
        className="fixed inset-0 w-full h-full object-cover scale-x-[-1] opacity-45 brightness-90 z-0"
        autoPlay
        playsInline
        muted
      />
      <div className="fixed inset-0 bg-[radial-gradient(circle,transparent_40%,rgba(0,0,0,0.3)_70%,rgba(0,0,0,0.6)_100%)] pointer-events-none z-10" />

      {/* Canvas Layer */}
      <div ref={containerRef} className={`fixed inset-0 z-20 ${domainShock ? 'animate-domain-shock' : ''}`}>
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>

      {/* Hand Tracking Layer */}
      <canvas
        ref={handCanvasRef}
        className="fixed inset-0 z-30 pointer-events-none"
      />

      {/* Slashes Layer */}
      <div className="fixed inset-0 z-[35] pointer-events-none overflow-hidden">
        {slashes.map(slash => (
          <div
            key={slash.id}
            className="absolute h-[3px] rounded-full bg-gradient-to-r from-transparent via-white to-red-600 shadow-[0_0_22px_rgba(255,80,80,0.9)] transition-all duration-200 ease-out"
            style={slash.style}
          />
        ))}
      </div>

      {/* Debris Layer */}
      <div className="fixed inset-0 z-[34] pointer-events-none overflow-hidden">
        {debris.map(d => (
          <div
            key={d.id}
            className="absolute"
            style={d.style}
          />
        ))}
      </div>

      {/* UI Overlay */}
      <div className="relative z-40 p-8 h-full flex flex-col justify-between pointer-events-none">
        {/* Top Bar */}
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[14px] tracking-[0.18em] uppercase text-white/70">
              <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,0,0,0.4)] ${cameraStatus === 'Active' ? 'bg-[#ff2a2a] shadow-[0_0_18px_rgba(255,80,80,0.9)] animate-pulse' : 'bg-[#7c0000]'}`} />
              <span>Camera {cameraStatus === 'Active' ? 'Active' : 'Off'}</span>
            </div>
            {cameraError && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex flex-col gap-3"
              >
                <div className="text-[10px] text-red-500/90 tracking-widest uppercase max-w-[300px] leading-relaxed">
                  {cameraError}
                </div>
                <button 
                  onClick={handleRetryCamera}
                  className="w-fit px-4 py-1.5 rounded-full border border-red-500/30 bg-red-500/10 text-[10px] text-red-400 tracking-[0.2em] uppercase hover:bg-red-500/20 transition-colors pointer-events-auto"
                >
                  Retry Connection
                </button>
              </motion.div>
            )}
          </div>
          <div className="flex flex-col items-end gap-3 text-right">
            <div className="text-[13px] tracking-[0.32em] uppercase text-red-200/78">
              Domain: <span>{currentDomainName || 'None'}</span>
            </div>
            <button 
              onClick={() => setIsMuted(!isMuted)}
              className="group flex items-center gap-3 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md hover:bg-white/10 transition-all pointer-events-auto"
              title={isMuted ? "Unmute" : "Mute"}
            >
              <span className="text-[10px] tracking-[0.2em] uppercase text-white/40 group-hover:text-white/70 transition-colors">
                {isMuted ? "Audio Off" : "Audio On"}
              </span>
              {isMuted ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-blue-400 animate-pulse" />
              )}
            </button>
          </div>
        </div>


        {/* Center Progress */}
        <AnimatePresence>
          {gestureProgress > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-4"
            >
              <div className="w-[220px] h-[5px] bg-white/10 rounded-[3px] overflow-hidden">
                <motion.div
                  className={`h-full rounded-[3px] shadow-[0_0_18px_rgba(255,80,80,1)] ${
                    stateRef.current.activeTechniques.purple
                      ? 'bg-gradient-to-r from-purple-600 via-purple-400 to-white shadow-[0_0_20px_rgba(160,80,255,1)]'
                      : stateRef.current.activeDomain === 'gojo_void' || activePill === 'Unlimited Void'
                      ? 'bg-gradient-to-r from-[#2d7bb5] via-[#5da8d8] to-[#ffffff] shadow-[0_0_20px_rgba(160,216,239,1)]'
                      : 'bg-gradient-to-r from-[#330000] via-[#ff0000] to-[#ff9966] shadow-[0_0_18px_rgba(255,80,80,1)]'
                  }`}
                  style={{ width: `${gestureProgress * 100}%` }}
                />
              </div>
              <span className={`text-[12px] tracking-[0.38em] uppercase ${
                stateRef.current.activeDomain === 'gojo_void' || activePill === 'Unlimited Void'
                  ? 'text-blue-100/80 [text-shadow:0_0_10px_rgba(160,216,239,0.5)]'
                  : isPurpleReady
                  ? 'text-purple-300 [text-shadow:0_0_15px_rgba(160,80,255,0.8)] animate-pulse'
                  : 'text-red-200/80 [text-shadow:0_0_12px_rgba(255,80,80,0.7)]'
              }`}>
                {stateRef.current.activeDomain === 'gojo_void' || activePill === 'Unlimited Void' 
                  ? 'Channeling Energy' 
                  : isPurpleReady 
                  ? 'Hollow Purple Ready' 
                  : 'Form the Shrine Seal'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hold Instruction */}
        <AnimatePresence>
          {showHoldInstruction && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center z-50"
            >
              <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
                <span className="text-[9px] tracking-[0.3em] uppercase text-white/50 font-medium whitespace-nowrap">
                  Hold the sign until the domain is formed
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Detection Pill */}
        <div className="absolute bottom-24 right-8">
          <AnimatePresence>
            {activePill && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={`px-6 py-2 rounded-full border text-[10px] tracking-[0.3em] uppercase backdrop-blur-md ${
                  activePill === 'Malevolent Shrine' 
                    ? 'border-red-500/50 bg-red-950/30 text-red-400 shadow-[0_0_20px_rgba(255,0,0,0.2)]' 
                    : activePill === 'Unlimited Void'
                    ? 'border-blue-400 bg-blue-950/80 text-blue-300 shadow-[0_0_25px_rgba(160,216,239,0.6)]'
                    : activePill === 'Hollow Purple'
                    ? 'border-purple-400 bg-purple-950/80 text-purple-300 shadow-[0_0_30px_rgba(160,80,255,0.7)]'
                    : 'border-blue-500/50 bg-blue-950/30 text-blue-400 shadow-[0_0_20px_rgba(0,0,255,0.2)]'
                }`}
              >
                {activePill === 'Unlimited Void' ? 'Gojo ◈ Detected' : `${activePill} Detected`}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Bar */}
        <div className="flex justify-between items-end">
          <div className="max-w-xs">
            <div className="text-[10px] tracking-[0.3em] uppercase opacity-40 mb-2">Detected Sign</div>
            <div className="h-6">
              <AnimatePresence mode="wait">
                {detectedSign && (
                  <motion.div
                    key={detectedSign}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`text-sm tracking-widest ${detectedSign === 'Unlimited Void' ? 'text-blue-300' : 'text-red-300'}`}
                  >
                    {detectedSign}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="flex-1 flex justify-center">
            <div className={`text-[40px] tracking-[0.32em] uppercase opacity-90 transition-all duration-1000 ${
              stateRef.current.activeDomain === 'gojo_void' ? 'text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.6)]' : '[text-shadow:0_0_22px_rgba(255,80,80,0.8)]'
            }`}>
              {stateRef.current.activeDomain === 'gojo_void' && stateRef.current.domainState !== DOMAIN_STATES.IDLE ? '術式展開' : 
               stateRef.current.activeDomain === 'sukuna_shrine' && stateRef.current.domainState !== DOMAIN_STATES.IDLE ? 'RYOMEN SUKUNA' : ''}
            </div>
          </div>
          <div className="w-32 flex justify-end">
            <a 
              href="https://github.com/Rapid1234-star/JJK-Fun-Gesture" 
              target="_blank" 
              rel="noopener noreferrer"
              className="group pointer-events-auto transition-transform hover:scale-110 active:scale-95"
            >
              <img 
                src="/Images/github.png" 
                alt="GitHub" 
                className="w-10 h-10 invert opacity-60 group-hover:opacity-100 transition-opacity drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]"
              />
            </a>
          </div>

        </div>
      </div>

      <div className="fixed left-3 top-1/2 z-[600] -translate-y-1/2 pointer-events-none">
        <div className="pointer-events-auto flex flex-col gap-1 rounded-r-2xl border border-white/10 border-l-0 bg-black/35 px-2 py-3 backdrop-blur-md shadow-[0_0_25px_rgba(0,0,0,0.25)]">
          <div className="px-2 text-[9px] tracking-[0.3em] uppercase text-white/35">
            Voice
          </div>
          <button
            type="button"
            onClick={() => setVoiceLanguage('en')}
            aria-pressed={voiceLanguage === 'en'}
            className={`min-w-[64px] rounded-xl px-3 py-2 text-[10px] tracking-[0.3em] uppercase transition-all ${
              voiceLanguage === 'en'
                ? 'bg-blue-300/20 text-blue-100 shadow-[0_0_20px_rgba(160,216,239,0.25)]'
                : 'bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/70'
            }`}
            title="Switch voice lines to English"
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setVoiceLanguage('jp')}
            aria-pressed={voiceLanguage === 'jp'}
            className={`min-w-[64px] rounded-xl px-3 py-2 text-[10px] tracking-[0.3em] uppercase transition-all ${
              voiceLanguage === 'jp'
                ? 'bg-red-500/20 text-red-100 shadow-[0_0_20px_rgba(255,80,80,0.25)]'
                : 'bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/70'
            }`}
            title="Switch voice lines to Japanese"
          >
            Japanese
          </button>
        </div>
      </div>

      {/* Intro Overlay */}
      <AnimatePresence>
        {showIntro && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(112,54,180,0.16)_0%,rgba(29,10,52,0.72)_28%,rgba(0,0,0,0.96)_72%)]" />
            <div className="relative text-center max-w-lg px-8 py-10 rounded-[28px] bg-gradient-to-b from-[#140c20]/78 to-[#080412]/82 border border-white/10 shadow-[0_18px_80px_rgba(111,39,255,0.16)] backdrop-blur-[18px] overflow-hidden">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-[11px] tracking-[0.42em] uppercase text-purple-200/66 mb-4"
              >
                Jujutsu Kaisen Experience
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-5xl font-serif tracking-[0.01em] text-[#f6efff] mb-4 drop-shadow-[0_0_18px_rgba(189,128,255,0.22)]"
              >
                Enter for an experience
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-sm leading-relaxed text-purple-100/75 mb-8 font-light tracking-wide max-w-[34ch] mx-auto"
              >
                Step into the void. Audio begins with entry, and the full cinematic sequence awakens the moment you proceed.
              </motion.p>
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 }}
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleEnter}
                className="relative px-12 py-4 rounded-full border border-purple-200/22 bg-[radial-gradient(circle_at_50%_50%,rgba(161,86,255,0.34),rgba(68,20,126,0.62))] text-[#fff6ff] text-xs tracking-[0.24em] uppercase shadow-[0_0_30px_rgba(150,75,255,0.25)] pointer-events-auto overflow-hidden"
              >
                Enter for an experience
              </motion.button>
              <div className="mt-4 text-[11px] tracking-[0.12em] uppercase text-purple-200/48">
                Tap once to begin the atmosphere
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Styles for the experience */}
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap');
        .font-serif { font-family: 'Noto Serif JP', serif; }
        @keyframes voidGlow {
          0%   { text-shadow: 0 0 40px rgba(160,216,239,0.8), 0 0 80px rgba(100,180,240,0.6), 0 0 120px rgba(60,140,220,0.4); }
          50%  { text-shadow: 0 0 60px rgba(200,235,255,1), 0 0 120px rgba(160,216,239,0.9), 0 0 180px rgba(100,180,240,0.7), 0 0 240px rgba(60,140,220,0.5); }
          100% { text-shadow: 0 0 40px rgba(160,216,239,0.8), 0 0 80px rgba(100,180,240,0.6), 0 0 120px rgba(60,140,220,0.4); }
        }
        @keyframes shake {
          0% { transform: translate(1px, 1px) rotate(0deg); }
          10% { transform: translate(-1px, -2px) rotate(-1deg); }
          20% { transform: translate(-3px, 0px) rotate(1deg); }
          30% { transform: translate(3px, 2px) rotate(0deg); }
          40% { transform: translate(1px, -1px) rotate(1deg); }
          50% { transform: translate(-1px, 2px) rotate(-1deg); }
          60% { transform: translate(-3px, 1px) rotate(0deg); }
          70% { transform: translate(3px, 1px) rotate(-1deg); }
          80% { transform: translate(-1px, -1px) rotate(1deg); }
          90% { transform: translate(1px, 2px) rotate(0deg); }
          100% { transform: translate(1px, -2px) rotate(-1deg); }
        }
        .animate-shake {
          animation: shake 0.5s;
          animation-iteration-count: infinite;
        }
      `}} />
    </div>
  );
}
