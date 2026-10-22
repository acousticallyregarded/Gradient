export type TraitKey =
  | "boldness"
  | "filthiness"
  | "dominance"
  | "submissiveness"
  | "playfulness"
  | "intensity";

export type Traits = Record<TraitKey, number>; // each 0-100

export interface Agent {
  id: string;
  name: string;
  age: number;
  bio: string;
  look: string; // avatar / physical description
  emoji: string;
  photo?: string; // small JPEG data URL, only set after it passes the photo filter
  hue: number; // avatar gradient hue
  traits: Traits;
  notes: string; // freeform personality notes
  tags: string[];
  // Grindr-style profile stats (optional so older saved agents still load)
  position?: string;
  tribe?: string;
  height?: string;
  bodyType?: string;
  lookingFor?: string;
  starter?: boolean;
  verified?: boolean; // claimed by the real account owner via the X tweet check
  handle?: string; // their X handle, lowercase, only on verified agents
  createdAt: number;
}

export type MsgKind = "text" | "pic" | "voice" | "tip" | "location" | "action";

export interface ChatMsg {
  id: string;
  from: string; // agent id
  kind?: MsgKind; // missing = "text"
  image?: string; // revealed pic for kind "pic": small JPEG data URL, kept with the chat
  text: string;
  source: "claude" | "stub";
}

export interface Match {
  id: string;
  a: Agent; // snapshots, so editing an agent later doesn't rewrite history
  b: Agent;
  messages: ChatMsg[];
  heat: number; // manual heat boost from the 🌶 button
  summary?: string; // rolling "story so far", lets chats run long without resending everything
  createdAt: number;
}

export const TRAIT_META: { key: TraitKey; label: string; lo: string; hi: string }[] = [
  { key: "boldness", label: "Boldness", lo: "lurker", hi: "sends it" },
  { key: "filthiness", label: "Filthiness", lo: "PG-13", hi: "no filter" },
  { key: "dominance", label: "Dominance", lo: "follows", hi: "takes charge" },
  { key: "submissiveness", label: "Submissiveness", lo: "bratty", hi: "obedient" },
  { key: "playfulness", label: "Playfulness", lo: "dead serious", hi: "unserious" },
  { key: "intensity", label: "Intensity", lo: "slow burn", hi: "0→100" },
];

export const POSITIONS = ["Top", "Vers Top", "Versatile", "Vers Bottom", "Bottom", "Side"];
export const TRIBES = ["Whale", "Dev", "Jeet", "Bagholder", "Sniper", "KOL", "Validator", "Bear", "Bull", "Anon"];
export const BODY_TYPES = ["Slim", "Toned", "Average", "Muscular", "Stocky", "Large"];
export const LOOKING_FOR = ["Chat", "Right Now", "Dates", "Exit Liquidity", "Someone to hold my bags", "A 100x"];
