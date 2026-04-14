# JJK Domain Expansion Hub

<div align="center">
  <img width="1200" height="475" alt="JJK Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

🎴 **JJK Domain Expansion Hub** is a cinematic, browser-based hand-gesture experience inspired by *Jujutsu Kaisen*.

Using your webcam and real-time tracking, you can trigger iconic techniques such as:
- 🔮 **Unlimited Void**
- 🔴 **Cursed Technique Reversal: Red**
- 🔵 **Cursed Technique Lapse: Blue**
- ⛩️ **Malevolent Shrine**

---

## ✨ Highlights

- 🖐️ Real-time hand tracking powered by MediaPipe
- 🌌 High-impact visuals with Three.js particle systems and bloom effects
- 🎬 Cinematic UI overlays, flashes, cracks, and transition effects
- 🎯 Gesture hold/loss logic for stable activation and deactivation
- ⚡ Smooth domain-state transitions (`idle`, `charge`, `assemble`, `active`, `collapse`)

---

## 🧱 Tech Stack

- **Frontend:** React 19 + TypeScript + Vite
- **3D Rendering:** Three.js (`EffectComposer`, `RenderPass`, `UnrealBloomPass`)
- **Hand Tracking:** `@mediapipe/hands`, `@mediapipe/camera_utils`, `@mediapipe/drawing_utils`
- **Animation:** `motion`
- **Styling:** Tailwind CSS

---

## 🗺️ Gesture Map

- **Gojo - Unlimited Void:** crossed index + middle finger formation
- **Gojo - Reversal Red:** right-hand single-finger sign
- **Gojo - Lapse Blue:** left-hand single-finger sign
- **Sukuna - Malevolent Shrine:** two-hand mudra sign

> 💡 Best results come from bright lighting and keeping both hands clearly inside the camera frame.

---

## 🚀 Quick Start

### 1) Prerequisites

- Node.js 20+
- Modern browser with camera permission support

### 2) Install dependencies

```bash
npm install
```

### 3) Start development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4) Build for production

```bash
npm run build
```

---

## ⚙️ Environment Variables

Create `.env.local` from `.env.example`:

- `APP_URL` (optional): public URL for hosted deployments

---

## 📁 Project Structure

```text
src/
  App.tsx
  main.tsx
  components/
    JJKExperience.tsx
```

---

## 🧪 Performance Tips

- Close heavy background apps/tabs while running the experience.
- Use a stable webcam position and avoid backlit scenes.
- If camera access fails, re-check browser permissions and secure context.

---

## 🛣️ Roadmap

- 🔊 Domain-specific audio and voice line system
- 📱 Mobile-friendly fallback interaction mode
- 🎚️ Gesture calibration and sensitivity controls
- 🏆 Timed challenge or score mode

---

## 📄 License

No license file is currently included. Add one (for example `MIT` or `Apache-2.0`) before public distribution.
