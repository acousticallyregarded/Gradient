// The 3D gay bar. Plain three.js, low-poly, no models or textures to download: everything is
// boxes, cylinders and canvas-drawn sprites so it stays light on phones and inside the static demo.
import * as THREE from "three";
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
];

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
];

export interface WorldHandlers {
  onSelect: (id: string) => void; // tapped an agent (or the bartender)
  onArrive: (id: string) => void; // walked up to them
}

interface Guest {
  id: string;
  agent: Agent | null;
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Sprite;
  spot: Spot;
  home: THREE.Vector3;
  phase: number;
  label: HTMLButtonElement;
  say: HTMLSpanElement;
  sayUntil: number;
}

const tmp = new THREE.Vector3();

export class BarWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private guests = new Map<string, Guest>();
  private player!: Guest;
  private target: THREE.Vector3 | null = null;
  private approach: string | null = null;
  private dateWith: string | null = null;
  private keys = new Set<string>();
  private tiles: THREE.MeshBasicMaterial[] = [];
  private lights: THREE.PointLight[] = [];
  private spots: THREE.Mesh[] = [];
  private ball!: THREE.Mesh;
  private floor!: THREE.Mesh;
  private marker!: THREE.Mesh;
  private camPos = new THREE.Vector3(0, 9, 14);
  private camLook = new THREE.Vector3(0, 1, 0);
  private ro: ResizeObserver;
  private nextChatter = 2;
  private labels: HTMLDivElement;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private h: WorldHandlers,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "bar-canvas";
    host.appendChild(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "bar-labels";
    host.appendChild(this.labels);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    this.scene.background = new THREE.Color(0x07030c);
    this.scene.fog = new THREE.Fog(0x07030c, 16, 34);

    this.buildRoom();
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
      const at = this.player ? this.player.group.position.clone() : new THREE.Vector3(0, 0, 5.2);
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
    const from = this.player.group.position;
    const dir = tmp.copy(from).sub(g.group.position).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(id === BARTENDER ? 0 : 1.15);
    const t = g.group.position.clone().add(dir);
    if (id === BARTENDER) t.set(g.group.position.x, 0, -4.9);
    this.target = this.clampWalk(t);
  }

  // Close-up camera on the pair while a date is open; null goes back to roaming.
  setDate(id: string | null) {
    this.dateWith = id;
    this.labels.classList.toggle("hidden", !!id);
    // Dating-sim focus: everyone else fades out while you two talk.
    for (const g of this.guests.values()) g.group.visible = !id || g === this.player || g.id === id;
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
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(o as THREE.Sprite).isSprite) m.geometry?.dispose(); // sprites share one geometry
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mat) => {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      });
    });
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
    for (const g of this.guests.values()) if (g !== this.player) pickables.push(g.body, g.head);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit) {
      const id = hit.object.userData.guest as string;
      this.h.onSelect(id);
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
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.animateRoom(t);
    this.movePlayer(dt);
    this.animateGuests(t);
    this.moveCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels(t);
  };

  private movePlayer(dt: number) {
    if (!this.player) return;
    const p = this.player.group.position;
    const kx = (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0) - (this.keys.has("a") || this.keys.has("arrowleft") ? 1 : 0);
    const kz = (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0) - (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0);
    let moving = false;
    const speed = 4.2;
    if ((kx || kz) && !this.dateWith) {
      this.target = null;
      this.approach = null;
      const step = new THREE.Vector3(kx, 0, kz).normalize().multiplyScalar(speed * dt);
      p.copy(this.clampWalk(p.clone().add(step)));
      this.player.group.rotation.y = Math.atan2(kx, kz);
      moving = true;
    } else if (this.target) {
      const d = tmp.copy(this.target).sub(p).setY(0);
      const dist = d.length();
      if (dist < 0.08) {
        this.target = null;
        if (this.approach) {
          const id = this.approach;
          this.approach = null;
          this.h.onArrive(id);
        }
      } else {
        d.multiplyScalar(Math.min(1, (speed * dt) / dist));
        p.copy(this.clampWalk(p.clone().add(d), this.approach));
        this.player.group.rotation.y = Math.atan2(d.x, d.z);
        moving = true;
      }
    }
    // little hop when walking
    this.player.body.position.y = 0.55 + (moving ? Math.abs(Math.sin(this.clock.elapsedTime * 12)) * 0.08 : 0);
    const mm = this.marker.material as THREE.MeshBasicMaterial;
    mm.opacity = Math.max(0, mm.opacity - dt * (this.target ? 0.3 : 2));
  }

  private animateGuests(t: number) {
    for (const g of this.guests.values()) {
      if (g === this.player) continue;
      const ph = g.phase;
      if (g.spot.zone === "dance") {
        g.body.position.y = 0.55 + Math.abs(Math.sin(t * 4.2 + ph)) * 0.22;
        g.group.rotation.y = Math.sin(t * 1.3 + ph) * 1.2;
        g.group.position.x = g.home.x + Math.sin(t * 0.7 + ph) * 0.35;
        g.group.position.z = g.home.z + Math.cos(t * 0.9 + ph) * 0.25;
      } else {
        g.body.position.y = 0.55 + Math.sin(t * 1.6 + ph) * 0.03;
        g.body.rotation.z = Math.sin(t * 0.8 + ph) * 0.06;
      }
      // Turn toward you when you're close, like they noticed.
      if (this.player && g.id !== BARTENDER) {
        const d = g.group.position.distanceTo(this.player.group.position);
        if (d < 2.2 && g.spot.zone !== "dance") {
          g.group.rotation.y = Math.atan2(this.player.group.position.x - g.group.position.x, this.player.group.position.z - g.group.position.z);
        }
      }
      g.head.position.y = g.body.position.y + 0.95;
    }
    if (this.player) this.player.head.position.y = this.player.body.position.y + 0.95;
  }

  private moveCamera(dt: number) {
    if (!this.player) return;
    const p = this.player.group.position;
    const date = this.dateWith ? this.guests.get(this.dateWith) : null;
    let want: THREE.Vector3;
    let look: THREE.Vector3;
    if (date) {
      const mid = p.clone().add(date.group.position).multiplyScalar(0.5);
      const across = date.group.position.clone().sub(p).setY(0);
      const side = new THREE.Vector3(-across.z, 0, across.x).normalize();
      if (side.z < 0) side.negate(); // keep the camera on the open side of the room
      // Pulled back and aimed low, so the pair sits in the top half above the dialogue box.
      want = mid.clone().add(side.multiplyScalar(5.2)).setY(2.6);
      look = mid.setY(0.1);
    } else {
      const portrait = this.camera.aspect < 0.9;
      want = new THREE.Vector3(p.x * 0.85, portrait ? 10.5 : 8.5, p.z + (portrait ? 10.5 : 9));
      look = new THREE.Vector3(p.x * 0.92, 0.6, p.z - 1.2);
    }
    const k = 1 - Math.pow(0.02, dt);
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
      tmp.copy(g.group.position);
      tmp.y = g.head.position.y + 0.62;
      tmp.project(this.camera);
      const behind = tmp.z > 1;
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * hgt;
      const off = behind || x < -40 || x > w + 40 || y < -20 || y > hgt + 20;
      g.label.style.display = off ? "none" : "";
      if (!off) {
        const dist = this.camera.position.distanceTo(g.group.position);
        const s = Math.max(0.6, Math.min(1.1, 11 / dist));
        g.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
        g.label.style.zIndex = String(1000 - Math.round(dist * 10));
      }
      g.say.style.display = t < g.sayUntil ? "" : "none";
    }
  }

  private animateRoom(t: number) {
    const beat = Math.floor(t * 2.1);
    this.tiles.forEach((m, i) => {
      const on = (i * 7 + beat * 3) % 5;
      m.color.setHSL(((i * 37 + beat * 53) % 360) / 360, 0.95, on < 2 ? 0.5 : 0.12);
    });
    this.ball.rotation.y = t * 0.6;
    this.spots.forEach((s, i) => {
      const a = t * 0.5 + (i / this.spots.length) * Math.PI * 2;
      const r = 1.2 + (i % 3) * 0.9;
      s.position.set(5.5 + Math.cos(a) * r, 0.03, 1.4 + Math.sin(a) * r);
    });
    const dance = this.lights[1];
    if (dance) dance.color.setHSL((t * 0.08) % 1, 1, 0.55);
    const flicker = this.lights[0];
    if (flicker) flicker.intensity = 14 + (Math.sin(t * 23) > 0.97 ? -8 : 0);
  }

  // ---------- building ----------

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 58 : 48;
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
      const d = tmp.copy(out).sub(g.group.position).setY(0);
      const len = d.length();
      if (len < 0.75 && len > 0.0001) out.add(d.multiplyScalar((0.75 - len) / len));
    }
    return out;
  }

  private addGuest(id: string, agent: Agent | null, spot: Spot, isPlayer = false): Guest {
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    const hue = agent ? agent.hue : 30;
    const bodyMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(hue / 360, 0.75, isPlayer ? 0.5 : 0.42),
      emissive: new THREE.Color().setHSL(hue / 360, 0.9, 0.08),
      flatShading: true,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.42, 1.1, 7), bodyMat);
    body.position.y = 0.55;
    const chest = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.2, 0.1),
      new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(((hue + 120) % 360) / 360, 0.8, 0.5), flatShading: true }),
    );
    chest.position.set(0, 0.22, 0.3);
    body.add(chest);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: headTexture(agent), transparent: true }));
    head.scale.set(0.95, 0.95, 1);
    head.position.y = 1.5;
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 16),
      new THREE.MeshBasicMaterial({ color: isPlayer ? 0x14f195 : 0x000000, transparent: true, opacity: isPlayer ? 0.55 : 0.5 }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.015;
    group.add(body, head, blob);
    body.userData.guest = id;
    head.userData.guest = id;
    if (spot.zone === "bar" && !isPlayer && id !== BARTENDER) group.rotation.y = Math.PI;
    if (id === BARTENDER) {
      body.material = new THREE.MeshLambertMaterial({ color: 0x1a1a1a, flatShading: true });
      group.rotation.y = 0;
    }
    this.scene.add(group);

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

    const g: Guest = { id, agent, group, body, head, spot, home: group.position.clone(), phase: Math.random() * 6, label, say, sayUntil: 0 };
    this.guests.set(id, g);
    return g;
  }

  private removeGuest(id: string) {
    const g = this.guests.get(id);
    if (!g) return;
    this.scene.remove(g.group);
    g.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(o as THREE.Sprite).isSprite) m.geometry?.dispose();
      const mat = m.material as THREE.MeshBasicMaterial | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    });
    g.label.remove();
    this.guests.delete(id);
  }

  private buildRoom() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x7a5aaa, 0x1a0c22, 1.5));
    const addLight = (color: number, x: number, y: number, z: number, intensity: number, dist: number) => {
      const l = new THREE.PointLight(color, intensity, dist, 1.4);
      l.position.set(x, y, z);
      s.add(l);
      this.lights.push(l);
    };
    addLight(0xff2d8a, -1, 3.2, -4, 14, 13); // bar (flickers)
    addLight(0x14f195, 5.5, 3.4, 1.5, 16, 12); // dance floor (cycles)
    addLight(0x9945ff, -7.5, 2.8, 1.6, 10, 10); // booths
    addLight(0x2aa8ff, 8.2, 2.6, -4, 8, 9); // jukebox
    addLight(0xff6a3d, -1, 3, 5.5, 8, 11); // by the door

    // floor
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 18), new THREE.MeshLambertMaterial({ map: floorTexture() }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, 0, 0.5);
    s.add(this.floor);

    // walls
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture(), color: 0x8a7a9a });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(22, 6), wallMat);
    back.position.set(0, 3, -8);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(18, 6), wallMat);
    left.rotation.y = Math.PI / 2;
    left.position.set(-11, 3, 0.5);
    const right = left.clone();
    right.rotation.y = -Math.PI / 2;
    right.position.x = 11;
    s.add(back, left, right);

    // bar counter + shelves + bottles
    const wood = new THREE.MeshLambertMaterial({ color: 0x2a1622, flatShading: true });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(12, 1.15, 1.2), wood);
    counter.position.set(-1, 0.575, -6.1);
    const top = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.08, 1.4), new THREE.MeshLambertMaterial({ color: 0x0c0c0c }));
    top.position.set(-1, 1.19, -6.1);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(12, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2d8a }));
    strip.position.set(-1, 0.1, -5.48);
    s.add(counter, top, strip);
    for (let row = 0; row < 2; row++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(10, 0.06, 0.5), wood);
      shelf.position.set(-1, 1.9 + row * 0.75, -7.7);
      s.add(shelf);
      for (let i = 0; i < 16; i++) {
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.09, 0.42, 6),
          new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(((i * 47 + row * 90) % 360) / 360, 0.8, 0.45), transparent: true, opacity: 0.85 }),
        );
        bottle.position.set(-5.6 + i * 0.6 + (row ? 0.3 : 0), 2.15 + row * 0.75, -7.65);
        s.add(bottle);
      }
    }
    // stools
    const stoolMat = new THREE.MeshLambertMaterial({ color: 0x3a3a44, flatShading: true });
    for (const sp of SPOTS.filter((x) => x.zone === "bar")) {
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.75, 8), stoolMat);
      stool.position.set(sp.x, 0.375, sp.z - 0.45);
      s.add(stool);
    }

    // neon signs
    s.add(neon("GRADIENT", "#ff2d8a", 6, -1, 4.5, -7.9));
    s.add(neon("NO JEETS", "#14f195", 2.6, 6.6, 3.6, -7.9));
    s.add(neon("LIQUIDITY POOL", "#2aa8ff", 3.4, 10.95, 3.5, 1.5, -Math.PI / 2));
    s.add(neon("BACKROOM →", "#9945ff", 2.6, -10.95, 3.6, -4.2, Math.PI / 2));
    s.add(neon("bottoms up", "#ffb02e", 2.8, -10.95, 3.2, 2.6, Math.PI / 2));

    // backroom door
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshBasicMaterial({ color: 0x050208 }));
    door.rotation.y = Math.PI / 2;
    door.position.set(-10.98, 1.3, -4.2);
    const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 2.75), new THREE.MeshBasicMaterial({ color: 0x9945ff }));
    doorGlow.rotation.y = Math.PI / 2;
    doorGlow.position.set(-10.99, 1.3, -4.2);
    s.add(doorGlow, door);

    // dance floor tiles + disco ball + light spots
    for (let ix = 0; ix < 5; ix++) {
      for (let iz = 0; iz < 5; iz++) {
        const m = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const tile = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), m);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(3.5 + ix, 0.012, -0.6 + iz);
        s.add(tile);
        this.tiles.push(m);
      }
    }
    this.ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.45, 1),
      new THREE.MeshPhongMaterial({ color: 0xdddddd, specular: 0xffffff, shininess: 120, flatShading: true, emissive: 0x222222 }),
    );
    this.ball.position.set(5.5, 4.4, 1.4);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.6, 4), new THREE.MeshBasicMaterial({ color: 0x333333 }));
    cord.position.set(5.5, 5.4, 1.4);
    s.add(this.ball, cord);
    for (let i = 0; i < 10; i++) {
      const spot = new THREE.Mesh(
        new THREE.CircleGeometry(0.16, 10),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(i / 10, 1, 0.65),
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      spot.rotation.x = -Math.PI / 2;
      s.add(spot);
      this.spots.push(spot);
    }

    // booths: U-shaped benches with a table
    const vinyl = new THREE.MeshLambertMaterial({ color: 0x5a0f2e, flatShading: true });
    const table = new THREE.MeshLambertMaterial({ color: 0x1b1b1b, flatShading: true });
    for (const z of [-1.4, 3.8]) {
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 2.4), vinyl);
      seatBack.position.set(-9.8, 0.65, z);
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.9, 0.5), vinyl);
      b1.position.set(-7.6, 0.45, z - 1.15);
      const b2 = b1.clone();
      b2.position.z = z + 1.15;
      const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 10), table);
      tb.position.set(-8.6, 0.85, z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.85, 6), table);
      leg.position.set(-8.6, 0.42, z);
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      candle.position.set(-8.6, 0.96, z);
      s.add(seatBack, b1, b2, tb, leg, candle);
    }

    // jukebox
    const juke = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.1, 0.9), new THREE.MeshLambertMaterial({ color: 0x1a1030, flatShading: true }));
    juke.position.set(8.6, 1.05, -6.8);
    const jukeFace = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshBasicMaterial({ map: jukeTexture() }));
    jukeFace.position.set(8.6, 1.25, -6.34);
    s.add(juke, jukeFace);

    // walk-to marker
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 20),
      new THREE.MeshBasicMaterial({ color: 0x14f195, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    s.add(this.marker);
  }
}

const sameLook = (a: Agent, b: Agent) => a.name === b.name && a.emoji === b.emoji && a.hue === b.hue && a.photo === b.photo;

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

function headTexture(agent: Agent | null) {
  const [c, g] = canvas(128, 128);
  const t = tex(c);
  const hue = agent?.hue ?? 30;
  const ring = () => {
    g.lineWidth = 6;
    g.strokeStyle = `hsl(${hue} 95% 62%)`;
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.stroke();
  };
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, `hsl(${hue} 90% 55%)`);
  grad.addColorStop(1, `hsl(${(hue + 120) % 360} 80% 32%)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.font = "700 48px 'Plus Jakarta Sans', system-ui, sans-serif";
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(agent ? monogram(agent.name) : "B", 64, 68);
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
      g.arc(64, 64, 60, 0, Math.PI * 2);
      g.clip();
      const s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) * 0.2, s, s, 4, 4, 120, 120);
      g.restore();
      ring();
      t.needsUpdate = true;
    };
    img.src = src;
  }
  return t;
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
  for (const blur of [60, 30, 12]) {
    g.shadowBlur = blur;
    g.fillStyle = color;
    g.fillText(text, 512, 128);
  }
  g.shadowBlur = 4;
  g.fillStyle = "#fff";
  g.globalAlpha = 0.85;
  g.fillText(text, 512, 128);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  return m;
}

function floorTexture() {
  const [c, g] = canvas(512, 512);
  const n = 8;
  const s = 512 / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? "#1c1420" : "#2a2030";
      g.fillRect(i * s, j * s, s, s);
    }
  }
  // grime: spills, scuffs, a sticky patch
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
    const r = Math.random() * 6 + 1;
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let k = 0; k < 14; k++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? "120,60,20" : "40,10,30"},0.18)`;
    g.beginPath();
    g.ellipse(Math.random() * 512, Math.random() * 512, 12 + Math.random() * 30, 8 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.75, 2.25);
  return t;
}

function wallTexture() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = "#24182c";
  g.fillRect(0, 0, 512, 256);
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 9; col++) {
      const x = col * 64 - (row % 2 ? 32 : 0);
      g.fillStyle = `hsl(${280 + Math.random() * 30} 22% ${12 + Math.random() * 7}%)`;
      g.fillRect(x + 2, row * 16 + 2, 60, 12);
    }
  }
  // stickers and tags
  const tags = ["wagmi", "rug me", "gm", "♥", "ngmi", "send it", "LP", "xoxo"];
  g.font = "bold 18px monospace";
  for (let k = 0; k < 10; k++) {
    g.fillStyle = `hsla(${Math.random() * 360} 90% 60% / .55)`;
    g.save();
    g.translate(Math.random() * 480, 20 + Math.random() * 220);
    g.rotate((Math.random() - 0.5) * 0.6);
    g.fillText(tags[k % tags.length], 0, 0);
    g.restore();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.5);
  return t;
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
