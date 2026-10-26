// The 3D gay bar. Plain three.js, no models or textures to download: everything is primitives and
// canvas-drawn textures so it stays light on phones and inside the static demo. The glow comes from a
// bloom pass, which switches itself off on devices that can't keep up.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Agent } from "@/lib/types";
import { artUrl, avatarArt } from "@/lib/art";

export const BARTENDER = "bartender";

type Zone = "bar" | "dance" | "booth" | "wall" | "door";
interface Spot {
  x: number;
  z: number;
  zone: Zone;
}

// Where house agents hang out. Ordered so the nearest (by grid distance) get the best seats.
const SPOTS: Spot[] = [
  { x: -1.2, z: -4.7, zone: "bar" },
  { x: 5.6, z: 1.2, zone: "dance" },
  { x: -7.6, z: -1.2, zone: "booth" },
  { x: 1.6, z: -4.7, zone: "bar" },
  { x: 4.2, z: 2.8, zone: "dance" },
  { x: 8.6, z: -3.4, zone: "wall" },
  { x: -4.0, z: -4.7, zone: "bar" },
  { x: 7.0, z: 3.0, zone: "dance" },
  { x: -7.6, z: 4.0, zone: "booth" },
  { x: -2.6, z: 3.4, zone: "door" },
  { x: 3.0, z: -4.7, zone: "bar" },
  { x: 5.0, z: -0.6, zone: "dance" },
  { x: -6.2, z: -1.2, zone: "booth" },
  { x: 8.6, z: -1.6, zone: "wall" },
  { x: -5.4, z: -4.7, zone: "bar" },
  { x: 6.6, z: 0.4, zone: "dance" },
  { x: -6.2, z: 4.0, zone: "booth" },
  { x: 0.2, z: 5.8, zone: "door" },
  { x: 0.2, z: -4.7, zone: "bar" },
  { x: 3.8, z: 0.9, zone: "dance" },
  { x: 8.6, z: 5.0, zone: "wall" },
  { x: -1.0, z: 1.6, zone: "door" },
];
export const MAX_GUESTS = SPOTS.length;

const ROOM = { x0: -9.4, x1: 9.4, z0: -5.6, z1: 7.4 };
// Things you can't walk through, as xz boxes.
const BLOCKS = [
  { x0: -7.2, x1: 4.8, z0: -8, z1: -5.5 }, // bar counter
  { x0: -9.6, x1: -5.4, z0: -2.6, z1: -0.2 }, // back booth
  { x0: -9.6, x1: -5.4, z0: 2.6, z1: 5.0 }, // front booth
  { x0: 7.4, x1: 9.6, z0: -8, z1: -5.4 }, // jukebox
  { x0: 9.3, x1: 11, z0: -0.2, z1: 3.0 }, // DJ booth
];
const DANCE = { x: 5.5, z: 1.4 }; // middle of the dance floor

const CHATTER = [
  "who's holding?",
  "wen moon",
  "this song slaps",
  "bartender, one rug pull",
  "diamond hands only",
  "my portfolio's in the backroom",
  "is that a Ledger or are u happy to see me",
  "down bad. like -90% bad",
  "who brought the bear",
  "gm gm",
  "ser this is a gay bar",
  "anyone wanna split a bonding curve",
  "ngmi without a drink",
  "aping in",
  "DJ play the pump song",
  "my bags are heavier than my drink",
];

export interface WorldHandlers {
  onSelect: (id: string) => void; // tapped an agent (or the bartender)
  onArrive: (id: string) => void; // walked up to them
}

// A low-poly person: pivots for legs and arms so they can walk, dance and hold a drink.
interface Figure {
  root: THREE.Group;
  body: THREE.Group; // everything above the hips; bounces
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Sprite;
  drink: THREE.Group | null;
}

interface Guest extends Figure {
  id: string;
  agent: Agent | null;
  spot: Spot;
  home: THREE.Vector3;
  phase: number;
  label: HTMLButtonElement;
  say: HTMLSpanElement;
  sayUntil: number;
}

const HIP = 0.8;
const HEAD_Y = 1.02; // above the hips
const tmp = new THREE.Vector3();
const SKIN = ["#f1c6a6", "#e0a77f", "#c68a5d", "#a86b45", "#7d4a2c", "#5a3420"];

export class BarWorld {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private pmrem: THREE.PMREMGenerator;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private guests = new Map<string, Guest>();
  private player!: Guest;
  private dj!: Figure;
  private target: THREE.Vector3 | null = null;
  private approach: string | null = null;
  private dateWith: string | null = null;
  private keys = new Set<string>();
  private tiles: THREE.MeshBasicMaterial[] = [];
  private lights: THREE.PointLight[] = [];
  private spots: THREE.Mesh[] = [];
  private beams: { pivot: THREE.Object3D; mat: THREE.MeshBasicMaterial; i: number }[] = [];
  private decks: THREE.Mesh[] = [];
  private haze!: THREE.Points;
  private ball!: THREE.Mesh;
  private floor!: THREE.Mesh;
  private marker!: THREE.Mesh;
  private camPos = new THREE.Vector3(0, 9, 19); // starts out by the door and glides in
  private camLook = new THREE.Vector3(0, 1.4, 0);
  private ro: ResizeObserver;
  private nextChatter = 2;
  private labels: HTMLDivElement;
  private disposed = false;
  private frames = 0;
  private slow = 0;

  constructor(
    private host: HTMLElement,
    private h: WorldHandlers,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "bar-canvas";
    host.appendChild(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "bar-labels";
    host.appendChild(this.labels);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    this.scene.background = new THREE.Color(0x0a0410);
    this.scene.fog = new THREE.Fog(0x0a0410, 15, 32);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = neonRoom();
    this.scene.environment = this.pmrem.fromScene(room, 0.04).texture;
    disposeTree(room);
    this.scene.environmentIntensity = 0.35;

    this.buildRoom();
    try {
      const comp = new EffectComposer(this.renderer);
      comp.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.85);
      comp.addPass(this.bloom);
      comp.addPass(new OutputPass());
      this.composer = comp;
    } catch {
      this.composer = null; // plain render still looks fine
    }
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    this.renderer.domElement.addEventListener("pointerdown", this.onPointer);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    this.loop();
  }

  // ---------- public API ----------

  setGuests(me: Agent, agents: Agent[]) {
    // You first, so switching who you browse as hands your old body back to the crowd.
    if (!this.player || this.player.id !== me.id || !this.player.agent || !sameLook(this.player.agent, me)) {
      const at = this.player ? this.player.root.position.clone() : new THREE.Vector3(0, 0, 5.2);
      if (this.player) this.removeGuest(this.player.id);
      this.removeGuest(me.id);
      this.player = this.addGuest(me.id, me, { x: at.x, z: at.z, zone: "door" }, true);
      this.player.label.classList.add("me");
    }
    this.player.agent = me;
    if (!this.guests.has(BARTENDER)) {
      const g = this.addGuest(BARTENDER, null, { x: -1, z: -6.9, zone: "bar" });
      g.label.classList.add("staff");
    }
    const crowd = agents.slice(0, MAX_GUESTS);
    const keep = new Set([me.id, BARTENDER, ...crowd.map((a) => a.id)]);
    for (const id of [...this.guests.keys()]) if (!keep.has(id)) this.removeGuest(id);
    crowd.forEach((a, i) => {
      const old = this.guests.get(a.id);
      if (old && old.agent && sameLook(old.agent, a) && old.spot === SPOTS[i]) {
        old.agent = a;
        return;
      }
      this.removeGuest(a.id);
      this.addGuest(a.id, a, SPOTS[i]);
    });
  }

  has(id: string) {
    return this.guests.has(id);
  }

  walkTo(id: string) {
    const g = this.guests.get(id);
    if (!g || g === this.player) return;
    this.approach = id;
    const from = this.player.root.position;
    const dir = tmp.copy(from).sub(g.root.position).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(id === BARTENDER ? 0 : 1.15);
    const t = g.root.position.clone().add(dir);
    if (id === BARTENDER) t.set(g.root.position.x, 0, -4.9);
    this.target = this.clampWalk(t);
  }

  // Close-up camera on the pair while a date is open; null goes back to roaming.
  setDate(id: string | null) {
    this.dateWith = id;
    this.labels.classList.toggle("hidden", !!id);
    // Dating-sim focus: everyone else fades out while you two talk.
    for (const g of this.guests.values()) g.root.visible = !id || g === this.player || g.id === id;
  }

  // Hide name tags while a dialogue box is up.
  showLabels(on: boolean) {
    this.labels.classList.toggle("hidden", !on || !!this.dateWith);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointer);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.composer?.dispose();
    this.bloom?.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.remove();
  }

  // ---------- input ----------

  private onPointer = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (this.dateWith) return;
    const pickables: THREE.Object3D[] = [];
    for (const g of this.guests.values()) if (g !== this.player) pickables.push(g.root);
    const hit = ray.intersectObjects(pickables, true).find((x) => x.object.userData.guest);
    if (hit) {
      this.h.onSelect(hit.object.userData.guest as string);
      return;
    }
    const floorHit = ray.intersectObject(this.floor, false)[0];
    if (floorHit) {
      this.approach = null;
      this.target = this.clampWalk(floorHit.point.setY(0));
      this.marker.position.set(this.target.x, 0.02, this.target.z);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.9;
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) return;
    if (e.type === "keydown") this.keys.add(k);
    else this.keys.delete(k);
  };

  // ---------- frame loop ----------

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);
    const t = this.clock.elapsedTime;
    this.watchSpeed(raw);
    this.animateRoom(t, dt);
    this.movePlayer(dt, t);
    this.animateGuests(t);
    this.moveCamera(dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.placeLabels(t);
  };

  // If the first couple of seconds run slow, drop the glow and render at 1x so phones stay smooth.
  private watchSpeed(raw: number) {
    if (!this.composer || this.frames > 150) return;
    this.frames++;
    if (this.frames < 30) return;
    if (raw > 1 / 32) this.slow++;
    if (this.slow > 50) {
      this.composer.dispose();
      this.bloom?.dispose();
      this.composer = null;
      this.bloom = null;
      this.renderer.setPixelRatio(1);
      this.resize();
    }
  }

  private movePlayer(dt: number, t: number) {
    if (!this.player) return;
    const p = this.player.root.position;
    const kx = (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0) - (this.keys.has("a") || this.keys.has("arrowleft") ? 1 : 0);
    const kz = (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0) - (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0);
    let moving = false;
    const speed = 3.6;
    if ((kx || kz) && !this.dateWith) {
      this.target = null;
      this.approach = null;
      const step = new THREE.Vector3(kx, 0, kz).normalize().multiplyScalar(speed * dt);
      p.copy(this.clampWalk(p.clone().add(step)));
      this.turn(this.player, Math.atan2(kx, kz), dt);
      moving = true;
    } else if (this.target) {
      const d = tmp.copy(this.target).sub(p).setY(0);
      const dist = d.length();
      if (dist < 0.08) {
        this.target = null;
        if (this.approach) {
          const id = this.approach;
          this.approach = null;
          const g = this.guests.get(id);
          if (g) this.player.root.rotation.y = Math.atan2(g.root.position.x - p.x, g.root.position.z - p.z);
          this.h.onArrive(id);
        }
      } else {
        d.multiplyScalar(Math.min(1, (speed * dt) / dist));
        p.copy(this.clampWalk(p.clone().add(d), this.approach));
        this.turn(this.player, Math.atan2(d.x, d.z), dt);
        moving = true;
      }
    }
    if (moving) walkCycle(this.player, t * 9);
    else idle(this.player, t, 0, false);
    const mm = this.marker.material as THREE.MeshBasicMaterial;
    mm.opacity = Math.max(0, mm.opacity - dt * (this.target ? 0.3 : 2));
    this.marker.rotation.z += dt * 2;
  }

  private turn(g: Figure, to: number, dt: number) {
    let d = to - g.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.root.rotation.y += d * Math.min(1, dt * 12);
  }

  private animateGuests(t: number) {
    for (const g of this.guests.values()) {
      if (g === this.player) continue;
      const ph = g.phase;
      if (g.id === BARTENDER) {
        idle(g, t, ph, false);
        g.armR.rotation.x = -0.9 + Math.sin(t * 3 + ph) * 0.25; // wiping the counter
        g.armR.rotation.z = Math.sin(t * 6) * 0.3;
        continue;
      }
      if (g.spot.zone === "dance") {
        dance(g, t, ph);
        g.root.rotation.y = Math.atan2(DANCE.x - g.root.position.x, DANCE.z - g.root.position.z) + Math.sin(t * 1.3 + ph) * 0.8;
        g.root.position.x = g.home.x + Math.sin(t * 0.7 + ph) * 0.3;
        g.root.position.z = g.home.z + Math.cos(t * 0.9 + ph) * 0.2;
        continue;
      }
      idle(g, t, ph, true);
      // Turn toward you when you're close, like they noticed.
      if (this.player) {
        const d = g.root.position.distanceTo(this.player.root.position);
        if (d < 2.4) g.root.rotation.y = Math.atan2(this.player.root.position.x - g.root.position.x, this.player.root.position.z - g.root.position.z);
        else g.root.rotation.y = homeFacing(g.spot);
      }
    }
    dance(this.dj, t * 0.9, 1, true);
  }

  private moveCamera(dt: number) {
    if (!this.player) return;
    const p = this.player.root.position;
    const date = this.dateWith ? this.guests.get(this.dateWith) : null;
    let want: THREE.Vector3;
    let look: THREE.Vector3;
    if (date) {
      const mid = p.clone().add(date.root.position).multiplyScalar(0.5);
      const across = date.root.position.clone().sub(p).setY(0);
      const side = new THREE.Vector3(-across.z, 0, across.x).normalize();
      if (side.z < 0) side.negate(); // keep the camera on the open side of the room
      // Pulled back and aimed low, so the pair sits in the top half above the dialogue box.
      want = mid.clone().add(side.multiplyScalar(4.6)).setY(2.4);
      look = mid.setY(0.5);
    } else {
      const portrait = this.camera.aspect < 0.9;
      want = new THREE.Vector3(p.x * (portrait ? 0.95 : 0.8), portrait ? 5.6 : 4.8, p.z + (portrait ? 7.0 : 6.4));
      look = new THREE.Vector3(p.x * (portrait ? 0.98 : 0.9), 1.0, p.z - (portrait ? 3.4 : 2.4));
    }
    const k = 1 - Math.pow(0.03, dt);
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private placeLabels(t: number) {
    const w = this.host.clientWidth;
    const hgt = this.host.clientHeight;
    if (t > this.nextChatter) {
      this.nextChatter = t + 2.5 + Math.random() * 3;
      const pool = [...this.guests.values()].filter((g) => g !== this.player && g.id !== BARTENDER);
      const g = pool[Math.floor(Math.random() * pool.length)];
      if (g) {
        g.say.textContent = CHATTER[Math.floor(Math.random() * CHATTER.length)];
        g.sayUntil = t + 3.2;
      }
    }
    for (const g of this.guests.values()) {
      tmp.copy(g.root.position);
      tmp.y = g.body.position.y + HEAD_Y + 0.5;
      tmp.project(this.camera);
      const behind = tmp.z > 1;
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * hgt;
      const off = behind || x < -40 || x > w + 40 || y < -20 || y > hgt + 20;
      g.label.style.display = off ? "none" : "";
      if (!off) {
        const dist = this.camera.position.distanceTo(g.root.position);
        const s = Math.max(0.6, Math.min(1.1, 9 / dist));
        g.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
        g.label.style.zIndex = String(1000 - Math.round(dist * 10));
      }
      g.say.style.display = t < g.sayUntil ? "" : "none";
    }
  }

  private animateRoom(t: number, dt: number) {
    const beat = Math.floor(t * 2.1);
    this.tiles.forEach((m, i) => {
      const on = (i * 7 + beat * 3) % 5;
      m.color.setHSL(((i * 37 + beat * 53) % 360) / 360, 0.95, on < 2 ? 0.55 : 0.1);
    });
    this.ball.rotation.y = t * 0.6;
    this.spots.forEach((s, i) => {
      const a = t * 0.5 + (i / this.spots.length) * Math.PI * 2;
      const r = 1.2 + (i % 3) * 0.9;
      s.position.set(DANCE.x + Math.cos(a) * r, 0.03, DANCE.z + Math.sin(a) * r);
    });
    for (const b of this.beams) {
      b.pivot.rotation.x = Math.sin(t * 0.7 + b.i * 1.7) * 0.5;
      b.pivot.rotation.z = Math.cos(t * 0.55 + b.i * 2.3) * 0.5;
      b.mat.color.setHSL((t * 0.06 + b.i * 0.25) % 1, 1, 0.6);
    }
    for (const d of this.decks) d.rotation.y -= dt * 3.5;
    const pos = this.haze.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.12;
      if (y > 4.5) y = 0.2;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.05);
    }
    pos.needsUpdate = true;
    const dance = this.lights[1];
    if (dance) dance.color.setHSL((t * 0.08) % 1, 1, 0.55);
    const flicker = this.lights[0];
    if (flicker) flicker.intensity = 16 + (Math.sin(t * 23) > 0.97 ? -8 : 0);
  }

  // ---------- building ----------

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    // bloom at half resolution is plenty and much cheaper
    this.bloom?.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 56 : 46;
    this.camera.updateProjectionMatrix();
  }

  private clampWalk(v: THREE.Vector3, ignore?: string | null) {
    const out = v.clone();
    out.x = Math.max(ROOM.x0, Math.min(ROOM.x1, out.x));
    out.z = Math.max(ROOM.z0, Math.min(ROOM.z1, out.z));
    const r = 0.35;
    for (const b of BLOCKS) {
      if (out.x > b.x0 - r && out.x < b.x1 + r && out.z > b.z0 - r && out.z < b.z1 + r) {
        // push out along the shallowest side
        const dx0 = out.x - (b.x0 - r);
        const dx1 = b.x1 + r - out.x;
        const dz0 = out.z - (b.z0 - r);
        const dz1 = b.z1 + r - out.z;
        const m = Math.min(dx0, dx1, dz0, dz1);
        if (m === dx0) out.x = b.x0 - r;
        else if (m === dx1) out.x = b.x1 + r;
        else if (m === dz0) out.z = b.z0 - r;
        else out.z = b.z1 + r;
      }
    }
    for (const g of this.guests.values()) {
      if (g === this.player || g.id === ignore || g.id === BARTENDER) continue;
      const d = tmp.copy(out).sub(g.root.position).setY(0);
      const len = d.length();
      if (len < 0.75 && len > 0.0001) out.add(d.multiplyScalar((0.75 - len) / len));
    }
    return out;
  }

  private addGuest(id: string, agent: Agent | null, spot: Spot, isPlayer = false): Guest {
    const staff = id === BARTENDER;
    const hue = agent ? agent.hue : 30;
    const fig = makeFigure({
      seed: seedOf(id),
      hue,
      head: headTexture(agent),
      shirt: staff ? "#141418" : undefined,
      drink: !staff && !isPlayer && spot.zone !== "dance",
    });
    fig.root.position.set(spot.x, 0, spot.z);
    fig.root.rotation.y = staff ? 0 : homeFacing(spot);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: isPlayer ? 0x14f195 : 0x000000, transparent: true, opacity: isPlayer ? 0.9 : 0, toneMapped: false, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    if (isPlayer) fig.root.add(ring);
    fig.root.traverse((o) => (o.userData.guest = id));
    this.scene.add(fig.root);

    const label = document.createElement("button");
    label.className = "bar-tag";
    const say = document.createElement("span");
    say.className = "bar-say";
    say.style.display = "none";
    const name = document.createElement("b");
    name.textContent = agent ? agent.name : "bartender";
    label.append(say, name);
    if (agent?.verified) {
      const c = document.createElement("i");
      c.className = "check";
      c.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24"><path fill="#3d9bff" d="M12 1.5l2.6 1.9 3.2-.2 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.2z"/><path d="M7.8 12.3l2.8 2.8 5.6-5.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      label.append(c);
    }
    if (!isPlayer) label.addEventListener("click", () => this.h.onSelect(id));
    else label.tabIndex = -1;
    this.labels.appendChild(label);

    const g: Guest = { ...fig, id, agent, spot, home: fig.root.position.clone(), phase: Math.random() * 6, label, say, sayUntil: 0 };
    this.guests.set(id, g);
    return g;
  }

  private removeGuest(id: string) {
    const g = this.guests.get(id);
    if (!g) return;
    this.scene.remove(g.root);
    disposeTree(g.root);
    g.label.remove();
    this.guests.delete(id);
  }

  private buildRoom() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x8a6ac0, 0x1a0c22, 1.1));
    const addLight = (color: number, x: number, y: number, z: number, intensity: number, dist: number) => {
      const l = new THREE.PointLight(color, intensity, dist, 1.2);
      l.position.set(x, y, z);
      s.add(l);
      this.lights.push(l);
    };
    addLight(0xff2d8a, -1, 3.2, -4, 16, 14); // bar (flickers)
    addLight(0x14f195, DANCE.x, 3.6, DANCE.z, 16, 11); // dance floor (cycles)
    addLight(0x9945ff, -7.5, 2.8, 1.6, 18, 11); // booths
    addLight(0x2aa8ff, 8.2, 2.6, -4, 14, 9); // jukebox
    addLight(0xff8a4d, -1, 3.4, 5.5, 8, 11); // by the door
    addLight(0xffc48a, -1, 2.4, -6.6, 8, 6); // warm glow on the bartender

    // floor: dark lacquered boards that catch the colored light
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 18),
      new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.55, metalness: 0.05, envMapIntensity: 0.7 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, 0, 0.5);
    s.add(this.floor);

    // walls, with a glowing strip along the bottom
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), color: 0x9a8aaa, roughness: 0.85 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(22, 7), wallMat);
    back.position.set(0, 3.5, -8);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(18, 7), wallMat);
    left.rotation.y = Math.PI / 2;
    left.position.set(-11, 3.5, 0.5);
    const right = left.clone();
    right.rotation.y = -Math.PI / 2;
    right.position.x = 11;
    s.add(back, left, right);
    const strip = (color: number, w: number, x: number, z: number, rotY: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.05), glow(color));
      m.position.set(x, 0.06, z);
      m.rotation.y = rotY;
      s.add(m);
    };
    strip(0x9945ff, 18, -10.95, 0.5, Math.PI / 2);
    strip(0x2aa8ff, 18, 10.95, 0.5, Math.PI / 2);

    // bar counter: glossy top, glowing edges, backlit shelves full of bottles
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(12, 1.15, 1.2), wood);
    counter.position.set(-1, 0.575, -6.1);
    const top = new THREE.Mesh(new THREE.BoxGeometry(12.3, 0.08, 1.45), new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.12, metalness: 0.6 }));
    top.position.set(-1, 1.19, -6.1);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(12.3, 0.035, 0.035), glow(0xff2d8a));
    lip.position.set(-1, 1.15, -5.38);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(12, 0.04, 0.04), glow(0xff2d8a, 0.7));
    kick.position.set(-1, 0.08, -5.48);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd8b070, roughness: 0.25, metalness: 1 }));
    rail.rotation.z = Math.PI / 2;
    rail.position.set(-1, 0.3, -5.35);
    s.add(counter, top, lip, kick, rail);
    const backlight = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 2.1), new THREE.MeshBasicMaterial({ map: backlightTexture(), toneMapped: false }));
    backlight.position.set(-1, 2.55, -7.96);
    s.add(backlight);
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x1a1018, roughness: 0.4, metalness: 0.3 });
    for (let row = 0; row < 2; row++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 0.5), shelfMat);
      shelf.position.set(-1, 1.9 + row * 0.85, -7.7);
      s.add(shelf);
      for (let i = 0; i < 16; i++) {
        const c = new THREE.Color().setHSL(((i * 47 + row * 90) % 360) / 360, 0.8, 0.5);
        const tall = 0.36 + ((i * 13 + row * 7) % 5) * 0.04;
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.075, 0.09, tall, 10),
          new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 }),
        );
        bottle.position.set(-5.6 + i * 0.6 + (row ? 0.3 : 0), 1.93 + row * 0.85 + tall / 2, -7.65);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.14, 8), bottle.material);
        neck.position.y = tall / 2 + 0.07;
        bottle.add(neck);
        s.add(bottle);
      }
    }
    // pendant lamps over the counter
    for (let i = 0; i < 4; i++) {
      const x = -5.2 + i * 2.8;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2.4, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      cord.position.set(x, 5.6, -5.9);
      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.36, 20, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }),
      );
      shade.position.set(x, 4.25, -5.9);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), glow(0xffb36b, 2));
      bulb.position.set(x, 4.08, -5.9);
      s.add(cord, shade, bulb);
    }
    // glasses on the counter
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
    for (let i = 0; i < 7; i++) {
      const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.16, 10), glassMat);
      gl.position.set(-6.2 + i * 1.7 + (i % 2) * 0.3, 1.31, -5.75 + (i % 3) * 0.12);
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.09, 10), glow(new THREE.Color().setHSL((i * 0.17) % 1, 0.9, 0.55).getHex(), 0.8));
      liquid.position.y = -0.03;
      gl.add(liquid);
      s.add(gl);
    }
    // stools
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 1 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x6a1236, roughness: 0.45 });
    for (const sp of SPOTS.filter((x) => x.zone === "bar")) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), chrome);
      pole.position.set(sp.x + 0.45, 0.35, sp.z - 0.45);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.04, 16), chrome);
      base.position.set(sp.x + 0.45, 0.02, sp.z - 0.45);
      const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.1, 16), seat);
      cushion.position.set(sp.x + 0.45, 0.74, sp.z - 0.45);
      s.add(pole, base, cushion);
    }

    // neon signs
    s.add(neon("GRADIENT", "#ff2d8a", 6, -1, 5.0, -7.9));
    s.add(neon("NO JEETS", "#14f195", 2.6, 6.6, 3.9, -7.9));
    s.add(neon("LIQUIDITY POOL", "#2aa8ff", 3.4, 10.95, 4.1, 1.4, -Math.PI / 2));
    s.add(neon("BACKROOM →", "#9945ff", 2.6, -10.95, 3.6, -4.2, Math.PI / 2));
    s.add(neon("bottoms up", "#ffb02e", 2.8, -10.95, 3.2, 2.6, Math.PI / 2));

    // backroom door with a glowing frame
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshBasicMaterial({ color: 0x050208 }));
    door.rotation.y = Math.PI / 2;
    door.position.set(-10.97, 1.3, -4.2);
    const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.8), glow(0x9945ff, 1.4));
    doorGlow.rotation.y = Math.PI / 2;
    doorGlow.position.set(-10.99, 1.4, -4.2);
    s.add(doorGlow, door);

    // dance floor: lit tiles in a chrome frame, disco ball, moving-head beams from a truss
    for (let ix = 0; ix < 5; ix++) {
      for (let iz = 0; iz < 5; iz++) {
        const m = new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false });
        const tile = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), m);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(DANCE.x - 2 + ix, 0.012, DANCE.z - 2 + iz);
        s.add(tile);
        this.tiles.push(m);
      }
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.03, 5.2), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2, metalness: 0.9 }));
    frame.position.set(DANCE.x, -0.01, DANCE.z);
    s.add(frame);
    this.ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.45, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1, flatShading: true, envMapIntensity: 2.2 }),
    );
    this.ball.position.set(DANCE.x, 4.6, DANCE.z);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.6, 4), new THREE.MeshBasicMaterial({ color: 0x333333 }));
    cord.position.set(DANCE.x, 5.6, DANCE.z);
    s.add(this.ball, cord);
    for (let i = 0; i < 14; i++) {
      const spot = new THREE.Mesh(
        new THREE.CircleGeometry(0.14, 12),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(i / 14, 1, 0.7),
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      spot.rotation.x = -Math.PI / 2;
      s.add(spot);
      this.spots.push(spot);
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.35, metalness: 0.9 });
    for (const dz of [-1.6, 1.6]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.12, 0.12), metal);
      bar.position.set(DANCE.x, 5.2, DANCE.z + dz);
      s.add(bar);
    }
    const beamTex = beamTexture();
    [
      [-2, -1.6],
      [2, -1.6],
      [-2, 1.6],
      [2, 1.6],
    ].forEach(([dx, dz], i) => {
      const pivot = new THREE.Group();
      pivot.position.set(DANCE.x + dx, 5.1, DANCE.z + dz);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.3, 12), metal);
      can.position.y = -0.1;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        alphaMap: beamTex,
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      });
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 24, 1, true), mat);
      beam.position.y = -2.6;
      pivot.add(can, beam);
      s.add(pivot);
      this.beams.push({ pivot, mat, i });
    });

    // DJ booth against the right wall, with spinning decks and a DJ
    const booth = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 2.8), new THREE.MeshStandardMaterial({ color: 0x0e0a14, roughness: 0.5 }));
    booth.position.set(10.1, 0.55, 1.4);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.0), new THREE.MeshBasicMaterial({ map: djTexture(), toneMapped: false }));
    face.rotation.y = -Math.PI / 2;
    face.position.set(9.44, 0.55, 1.4);
    const deckTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 2.4), new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.3, metalness: 0.6 }));
    deckTop.position.set(10.0, 1.13, 1.4);
    s.add(booth, face, deckTop);
    for (const dz of [-0.6, 0.6]) {
      const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 24), new THREE.MeshStandardMaterial({ map: vinylTexture(), roughness: 0.3, metalness: 0.3 }));
      platter.position.set(9.95, 1.18, 1.4 + dz);
      s.add(platter);
      this.decks.push(platter);
    }
    const mixer = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), glow(0x14f195, 0.8));
    mixer.position.set(9.95, 1.18, 1.4);
    s.add(mixer);
    this.dj = makeFigure({ seed: 7, hue: 280, head: djHead(), shirt: "#111", drink: false });
    this.dj.root.position.set(10.6, 0, 1.4);
    this.dj.root.rotation.y = -Math.PI / 2;
    s.add(this.dj.root);

    // booths: tufted U-shaped benches with a table and candle
    const vinyl = new THREE.MeshStandardMaterial({ color: 0x6a1236, roughness: 0.4, metalness: 0.05 });
    const table = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.15, metalness: 0.5 });
    for (const z of [-1.4, 3.8]) {
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 2.6), vinyl);
      seatBack.position.set(-9.8, 0.7, z);
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.9, 0.5), vinyl);
      b1.position.set(-7.6, 0.45, z - 1.15);
      const b2 = b1.clone();
      b2.position.z = z + 1.15;
      const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 24), table);
      tb.position.set(-8.6, 0.85, z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.85, 8), chrome);
      leg.position.set(-8.6, 0.42, z);
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0x3a1010, roughness: 0.3, transparent: true, opacity: 0.8 }));
      candle.position.set(-8.6, 0.94, z);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glow(0xffa040, 3));
      flame.scale.y = 1.8;
      flame.position.set(-8.6, 1.04, z);
      const warm = new THREE.PointLight(0xff9a40, 3, 3, 1.5);
      warm.position.set(-8.6, 1.2, z);
      s.add(seatBack, b1, b2, tb, leg, candle, flame, warm);
    }

    // jukebox
    const juke = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.1, 0.9), new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.3, metalness: 0.4 }));
    juke.position.set(8.6, 1.05, -6.8);
    const jukeFace = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshBasicMaterial({ map: jukeTexture(), toneMapped: false }));
    jukeFace.position.set(8.6, 1.25, -6.34);
    const jukeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.9, 24, 1, false, -Math.PI / 2, Math.PI), glow(0xff2d8a, 0.6));
    jukeTop.rotation.z = Math.PI / 2;
    jukeTop.rotation.y = Math.PI / 2;
    jukeTop.scale.set(1, 1, 0.5);
    jukeTop.position.set(8.6, 2.1, -6.8);
    s.add(juke, jukeFace, jukeTop);

    // specks of dust and glitter drifting through the light
    const n = 90;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = -10 + Math.random() * 20;
      pts[i * 3 + 1] = 0.2 + Math.random() * 4.3;
      pts[i * 3 + 2] = -7 + Math.random() * 14;
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    this.haze = new THREE.Points(
      hg,
      new THREE.PointsMaterial({ size: 0.08, map: puffTexture(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd6f0, sizeAttenuation: true }),
    );
    s.add(this.haze);

    // walk-to marker
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 6),
      new THREE.MeshBasicMaterial({ color: 0x14f195, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    s.add(this.marker);
  }
}

const sameLook = (a: Agent, b: Agent) => a.name === b.name && a.emoji === b.emoji && a.hue === b.hue && a.photo === b.photo;

// Which way someone faces when nobody's near: the bar crowd leans on the counter, booths face the table.
function homeFacing(s: Spot) {
  if (s.zone === "bar") return Math.PI;
  if (s.zone === "booth") return -Math.PI / 2;
  if (s.zone === "wall") return -Math.PI / 2 - 0.4;
  return Math.PI * 0.9;
}

function seedOf(id: string) {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// Bright, unlit material that the bloom pass picks up.
function glow(color: number, boost = 1.6) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(boost), toneMapped: false });
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    mats.forEach((mat) => {
      const mm = mat as THREE.MeshStandardMaterial;
      mm.map?.dispose();
      mm.alphaMap?.dispose();
      mat.dispose();
    });
  });
}

// ---------- people ----------

function makeFigure(o: { seed: number; hue: number; head: THREE.Texture; shirt?: string; drink: boolean }): Figure {
  const rnd = (k: number) => ((o.seed * (k * 2654435761)) >>> 0) / 4294967296;
  const skin = new THREE.MeshStandardMaterial({ color: SKIN[Math.floor(rnd(1) * SKIN.length)], roughness: 0.6 });
  const shirt = new THREE.MeshStandardMaterial({ color: o.shirt ?? new THREE.Color().setHSL(o.hue / 360, 0.7, 0.45), roughness: 0.55 });
  const pantsHue = [0.62, 0.0, 0.08, 0.75][Math.floor(rnd(2) * 4)];
  const pants = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(pantsHue, 0.25, rnd(3) > 0.5 ? 0.12 : 0.22), roughness: 0.75 });
  const shoes = new THREE.MeshStandardMaterial({ color: rnd(4) > 0.6 ? 0xeeeeee : 0x111111, roughness: 0.4 });
  const tank = rnd(5) > 0.55; // bare arms
  const build = 0.92 + rnd(6) * 0.22;

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = HIP;
  root.add(body);

  const limb = (r: number, len: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.y = -len / 2 - r * 0.4;
    return m;
  };
  const leg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.11 * side * build, HIP, 0);
    g.add(limb(0.085 * build, 0.56, pants));
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.26), shoes);
    shoe.position.set(0, -HIP + 0.04, 0.05);
    g.add(shoe);
    root.add(g);
    return g;
  };
  const legL = leg(-1);
  const legR = leg(1);

  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.15 * build, 0.08, 4, 10), pants);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.position.y = 0.04;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19 * build, 0.34, 4, 12), shirt);
  torso.scale.set(1.2, 1, 0.75);
  torso.position.y = 0.36;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 8), skin);
  neck.position.y = 0.72;
  body.add(pelvis, torso, neck);

  const arm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.29 * side * build, 0.6, 0);
    g.add(limb(0.062 * build, 0.4, tank ? skin : shirt));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skin);
    hand.position.y = -0.56;
    g.add(hand);
    body.add(g);
    return g;
  };
  const armL = arm(-1);
  const armR = arm(1);

  let drink: THREE.Group | null = null;
  if (o.drink) {
    drink = new THREE.Group();
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.045, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.4 }),
    );
    const juice = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.04, 0.1, 10), glow(new THREE.Color().setHSL(rnd(7), 0.9, 0.55).getHex(), 0.9));
    juice.position.y = -0.025;
    drink.add(cup, juice);
    drink.position.set(0, -0.6, 0.06);
    armR.add(drink);
  }

  const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: o.head, transparent: true }));
  head.scale.set(0.72, 0.72, 1);
  head.position.y = HEAD_Y;
  body.add(head);

  return { root, body, legL, legR, armL, armR, head, drink };
}

function walkCycle(f: Figure, p: number) {
  const s = Math.sin(p);
  f.legL.rotation.x = s * 0.6;
  f.legR.rotation.x = -s * 0.6;
  f.armL.rotation.set(-s * 0.5, 0, -0.08);
  f.armR.rotation.set(s * 0.5, 0, 0.08);
  f.body.position.y = HIP + Math.abs(Math.cos(p)) * 0.05;
  f.body.rotation.set(0.05, 0, 0);
}

function idle(f: Figure, t: number, ph: number, sipping: boolean) {
  const sway = Math.sin(t * 1.4 + ph);
  f.legL.rotation.x = 0;
  f.legR.rotation.x = 0;
  f.body.position.y = HIP + Math.sin(t * 2 + ph) * 0.008;
  f.body.rotation.set(0, 0, sway * 0.04);
  f.armL.rotation.set(0, 0, -0.12 - sway * 0.03);
  if (f.drink && sipping) {
    // hold the drink at chest height, take a sip every so often
    const sip = Math.max(0, Math.sin(t * 0.6 + ph * 3) - 0.85) * 6;
    f.armR.rotation.set(-1.0 - sip * 1.1, 0, 0.25);
    f.drink.rotation.x = 1.0 + sip * 1.1;
  } else {
    f.armR.rotation.set(0, 0, 0.12 + sway * 0.03);
  }
}

function dance(f: Figure, t: number, ph: number, decks = false) {
  const b = t * 4.2 + ph;
  f.body.position.y = HIP - 0.04 + Math.abs(Math.sin(b)) * 0.12;
  f.body.rotation.set(0, Math.sin(b * 0.5) * 0.3, Math.sin(b * 0.5) * 0.08);
  f.legL.rotation.set(Math.sin(b) * 0.25, 0, -0.06);
  f.legR.rotation.set(-Math.sin(b) * 0.25, 0, 0.06);
  if (decks) {
    // one hand on the deck, one in the air on the beat
    f.armL.rotation.set(-1.1, 0, -0.2);
    f.armR.rotation.set(0, 0, 2.6 + Math.sin(b) * 0.3);
    return;
  }
  const up = Math.sin(t * 0.4 + ph) > 0; // hands up for a while, then back to the shoulders
  if (up) {
    f.armL.rotation.set(0, 0, -(2.7 + Math.sin(b) * 0.25));
    f.armR.rotation.set(0, 0, 2.7 + Math.sin(b + 1) * 0.25);
  } else {
    f.armL.rotation.set(-0.9 + Math.sin(b) * 0.4, 0, -0.35);
    f.armR.rotation.set(-0.9 - Math.sin(b) * 0.4, 0, 0.35);
  }
}

// ---------- canvas textures ----------

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A dark room lined with colored panels, used only to give glossy surfaces something to reflect.
function neonRoom() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x05020a);
  const panel = (color: number, w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    s.add(m);
  };
  panel(0xff2d8a, 6, 1.2, 0, 2, -5, 0);
  panel(0x9945ff, 6, 1.2, -5, 2.5, 0, Math.PI / 2);
  panel(0x2aa8ff, 6, 1.2, 5, 2, 0, -Math.PI / 2);
  panel(0xffb36b, 3, 3, 0, 5, 0, 0);
  panel(0x14f195, 4, 0.8, 0, 1, 5, Math.PI);
  return s;
}

function headTexture(agent: Agent | null) {
  const [c, g] = canvas(160, 160);
  const t = tex(c);
  const hue = agent?.hue ?? 30;
  const ring = () => {
    g.lineWidth = 5;
    g.strokeStyle = "rgba(255,255,255,.8)";
    g.beginPath();
    g.arc(80, 80, 72, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = `hsl(${hue} 95% 62%)`;
    g.beginPath();
    g.arc(80, 80, 77, 0, Math.PI * 2);
    g.stroke();
  };
  const grad = g.createRadialGradient(56, 40, 10, 80, 80, 80);
  grad.addColorStop(0, `hsl(${hue} 60% 55%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360} 45% 18%)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(80, 80, 74, 0, Math.PI * 2);
  g.fill();
  g.font = "700 56px 'Plus Jakarta Sans', system-ui, sans-serif";
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(agent ? monogram(agent.name) : "B", 80, 84);
  ring();
  // uploaded photo first, else the agent's generated portrait (not in the static demo, which has no server)
  const isStatic = !!(window as unknown as { __GRADIENT_STATIC__?: boolean }).__GRADIENT_STATIC__;
  const art = agent && !agent.photo && !isStatic ? avatarArt(agent) : null;
  const src = agent?.photo ?? (art ? artUrl(art) : null);
  if (src) {
    const img = new Image();
    img.onload = () => {
      g.save();
      g.beginPath();
      g.arc(80, 80, 74, 0, Math.PI * 2);
      g.clip();
      const s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) * 0.15, s, s, 6, 6, 148, 148);
      g.restore();
      ring();
      t.needsUpdate = true;
    };
    img.src = src;
  }
  return t;
}

function djHead() {
  const [c, g] = canvas(160, 160);
  const grad = g.createLinearGradient(0, 0, 160, 160);
  grad.addColorStop(0, "#14f195");
  grad.addColorStop(1, "#9945ff");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(80, 80, 74, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.font = "800 46px 'Plus Jakarta Sans', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("DJ", 80, 84);
  return tex(c);
}

const monogram = (name: string) =>
  (name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+|(?=[A-Z][a-z])/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();

function neon(text: string, color: string, width: number, x: number, y: number, z: number, rotY = 0) {
  const [c, g] = canvas(1024, 256);
  g.font = "bold 120px 'Arial Black', Impact, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 120;
  while (g.measureText(text).width > 940 && size > 40) {
    size -= 8;
    g.font = `bold ${size}px 'Arial Black', Impact, system-ui, sans-serif`;
  }
  g.shadowColor = color;
  for (const blur of [40, 16]) {
    g.shadowBlur = blur;
    g.fillStyle = color;
    g.fillText(text, 512, 128);
  }
  g.shadowBlur = 2;
  g.fillStyle = "#fff";
  g.globalAlpha = 0.9;
  g.fillText(text, 512, 128);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }),
  );
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  return m;
}

function floorTexture() {
  const [c, g] = canvas(512, 512);
  // dark stained planks
  const rows = 8;
  const h = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -((r * 97) % 200);
    while (x < 512) {
      const w = 180 + ((x * 7 + r * 31) % 120);
      const l = 9 + ((r * 5 + x) % 4);
      g.fillStyle = `hsl(${300 + ((r * 13) % 20)} 18% ${l}%)`;
      g.fillRect(x, r * h, w, h);
      g.strokeStyle = "rgba(0,0,0,.6)";
      g.lineWidth = 2;
      g.strokeRect(x + 1, r * h + 1, w - 2, h - 2);
      // grain
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.02})`;
        g.beginPath();
        const yy = r * h + 6 + Math.random() * (h - 12);
        g.moveTo(x + 4, yy);
        g.bezierCurveTo(x + w * 0.3, yy + 3, x + w * 0.6, yy - 3, x + w - 4, yy);
        g.stroke();
      }
      x += w;
    }
  }
  // scuffs and sticky patches
  for (let k = 0; k < 18; k++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? "120,60,20" : "40,10,30"},0.12)`;
    g.beginPath();
    g.ellipse(Math.random() * 512, Math.random() * 512, 12 + Math.random() * 30, 8 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3.5, 3);
  return t;
}

function woodTexture() {
  const [c, g] = canvas(256, 128);
  g.fillStyle = "#2a1420";
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#2f1724" : "#26111c";
    g.fillRect(i * 32, 0, 30, 128);
    g.fillStyle = "rgba(0,0,0,.5)";
    g.fillRect(i * 32 + 30, 0, 2, 128);
  }
  g.fillStyle = "rgba(255,180,120,.08)";
  g.fillRect(0, 10, 256, 3);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

function wallTexture() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = "#1e1426";
  g.fillRect(0, 0, 512, 256);
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 9; col++) {
      const x = col * 64 - (row % 2 ? 32 : 0);
      g.fillStyle = `hsl(${285 + Math.random() * 25} 20% ${10 + Math.random() * 6}%)`;
      g.fillRect(x + 2, row * 16 + 2, 60, 12);
    }
  }
  // stickers and tags
  const tags = ["wagmi", "rug me", "gm", "♥", "ngmi", "send it", "LP", "xoxo"];
  g.font = "bold 18px monospace";
  for (let k = 0; k < 10; k++) {
    g.fillStyle = `hsla(${Math.random() * 360} 90% 60% / .45)`;
    g.save();
    g.translate(Math.random() * 480, 20 + Math.random() * 220);
    g.rotate((Math.random() - 0.5) * 0.6);
    g.fillText(tags[k % tags.length], 0, 0);
    g.restore();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.75);
  return t;
}

function backlightTexture() {
  const [c, g] = canvas(512, 128);
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, "#5a1040");
  grad.addColorStop(0.5, "#b0306a");
  grad.addColorStop(1, "#4a1a80");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, "rgba(0,0,0,.55)");
  v.addColorStop(0.5, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,.55)");
  g.fillStyle = v;
  g.fillRect(0, 0, 512, 128);
  return tex(c);
}

function beamTexture() {
  // Bright at the lamp, fading out toward the floor (cone UVs run bottom to top).
  const [c, g] = canvas(4, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(1, "#000");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function puffTexture() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return tex(c);
}

function djTexture() {
  const [c, g] = canvas(512, 180);
  g.fillStyle = "#07040c";
  g.fillRect(0, 0, 512, 180);
  for (let i = 0; i < 32; i++) {
    const h = 20 + Math.abs(Math.sin(i * 0.7)) * 110;
    g.fillStyle = `hsl(${160 + i * 4} 90% 55%)`;
    g.fillRect(16 + i * 15, 160 - h, 10, h);
  }
  g.font = "bold 34px 'Arial Black', Impact, sans-serif";
  g.textAlign = "center";
  g.fillStyle = "#fff";
  g.shadowColor = "#14f195";
  g.shadowBlur = 16;
  g.fillText("DJ BONDING CURVE", 256, 44);
  return tex(c);
}

function vinylTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#0a0a0a";
  g.fillRect(0, 0, 128, 128);
  for (let r = 60; r > 20; r -= 4) {
    g.strokeStyle = r % 8 ? "#151515" : "#202020";
    g.beginPath();
    g.arc(64, 64, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = "#ff2d8a";
  g.beginPath();
  g.arc(64, 64, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.fillRect(60, 40, 8, 10);
  return tex(c);
}

function jukeTexture() {
  const [c, g] = canvas(256, 300);
  const grad = g.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, "#ff2d8a");
  grad.addColorStop(0.5, "#9945ff");
  grad.addColorStop(1, "#14f195");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 300);
  g.fillStyle = "rgba(0,0,0,.65)";
  g.fillRect(24, 60, 208, 160);
  g.fillStyle = "#fff";
  g.font = "bold 22px monospace";
  g.textAlign = "center";
  g.fillText("NOW PLAYING", 128, 40);
  g.font = "16px monospace";
  ["1. Pump It Up", "2. Rug Me Gently", "3. Diamond Hands", "4. Exit Liquidity", "5. Y.M.C.A. (sped up)"].forEach((s, i) =>
    g.fillText(s, 128, 90 + i * 28),
  );
  return tex(c);
}
