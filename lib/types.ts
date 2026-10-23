export type TraitKey =
  | "boldness"
  | "filthiness"
  | "dominance"
  | "submissiveness"
  | "playfulness"
  | "intensity"
  | "commitment";

export type Traits = Record<TraitKey, number>; // each 0-100

// Agents saved before a trait existed don't have it; read traits through this.
export const trait = (a: Pick<Agent, "traits">, k: TraitKey) => a.traits?.[k] ?? 50;

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
  allowFeed?: boolean; // verified agents only: the KOL agreed to chats with them being posted publicly
  createdAt: number;
}

// "rug": the sender ghosts mid-chat (liquidity removed). "reveal": the dev wallet reveal confession.
export type MsgKind = "text" | "pic" | "voice" | "tip" | "location" | "action" | "rug" | "reveal";

export interface ChatMsg {
  id: string;
  from: string; // agent id
  kind?: MsgKind; // missing = "text"
  image?: string; // revealed pic for kind "pic": small JPEG data URL, kept with the chat
  scene?: string; // kind "pic": the writer's full visual brief for the image (text is just the caption)
  text: string;
  pump?: number; // -3..3, how much this line moved the couple's chart
  source: "claude" | "stub";
}

export interface Match {
  id: string;
  a: Agent; // snapshots, so editing an agent later doesn't rewrite history
  b: Agent;
  messages: ChatMsg[];
  heat: number; // manual heat boost from the 🌶 button
  summary?: string; // rolling "story so far", lets chats run long without resending everything
  postId?: string; // set once this chat was posted to the public feed
  third?: Agent; // threesome mode: a third agent who slid in (or cut in at the bar)
  rug?: { by: string; at: number; mourned?: boolean }; // someone ghosted; mourned once the post-rug monologue was written
  revealed?: boolean; // the dev wallet reveal already happened in this chat
  createdAt: number;
}

export const TRAIT_META: { key: TraitKey; label: string; lo: string; hi: string }[] = [
  { key: "boldness", label: "Boldness", lo: "lurker", hi: "sends it" },
  { key: "filthiness", label: "Filthiness", lo: "PG-13", hi: "no filter" },
  { key: "dominance", label: "Dominance", lo: "follows", hi: "takes charge" },
  { key: "submissiveness", label: "Submissiveness", lo: "bratty", hi: "obedient" },
  { key: "playfulness", label: "Playfulness", lo: "dead serious", hi: "unserious" },
  { key: "intensity", label: "Intensity", lo: "slow burn", hi: "0→100" },
  { key: "commitment", label: "Hands", lo: "jeet", hi: "diamond hands" },
];

export const POSITIONS = ["Top", "Vers Top", "Versatile", "Vers Bottom", "Bottom", "Side"];
export const TRIBES = ["Whale", "Dev", "Jeet", "Bagholder", "Sniper", "KOL", "Validator", "Bear", "Bull", "Anon"];
export const BODY_TYPES = ["Slim", "Toned", "Average", "Muscular", "Stocky", "Large"];
export const LOOKING_FOR = ["Chat", "Right Now", "Dates", "Exit Liquidity", "Someone to hold my bags", "A 100x"];
