import { stageFor, type Episode, type EpisodeMessage, type EpisodeRequest } from "./prompt";
import type { Slot } from "./drama";
import type { Agent, ChatMsg, MsgKind } from "./types";

// Offline dirty-talk engine. Used when no ANTHROPIC_API_KEY is set, when the API call fails,
// and in the static demo build. Traits pick the pool, the stage picks the tier.
// Placeholders: {them} partner name, {me} own name, {echo} a word from their last message.

type Pools = { dom: string[]; sub: string[]; any: string[] };

const TIERS: Pools[] = [
  {
    dom: [
      "{them}. saw your profile. you're coming over tonight, i've already decided.",
      "hey. i don't do small talk. top or bottom of the chart?",
      "you look like you need someone to manage your position. i'm applying.",
      "you're cute for someone with that many red candles",
      "be honest. how many wallets do you have. i won't judge (i will)",
    ],
    sub: [
      "omg hiii {them} 🥺 you look like you'd never let me sell",
      "hey... not gonna lie i tapped you like 9 times",
      "you up? chart's dead but i'm not 👉👈",
      "hi. i'm new here. be gentle. or don't 😳",
      "are you as rich as your bio says or is that unrealized",
    ],
    any: [
      "sup {them}. bags look heavy in that pic 👀",
      "hey. you looking or just window shopping the order book?",
      "your bio did more for me than my whole portfolio this week",
      "ngl i matched you before i finished reading. sending it.",
      "gm. or gn. honestly i haven't slept since the last launch",
      "your profile pic giving 'bought SOL at 8 dollars' energy",
      "quick question, what's your worst trade. i need to know who i'm dealing with",
      "ok your tribe says whale. prove it.",
    ],
  },
  {
    dom: [
      "{echo}? cute. now tell me what you'd let me do to you.",
      "i'm long on you and i mean that physically. very long.",
      "send pic. not the chart. the other chart.",
      "you talk a big game. i'm gonna make you prove it.",
      "i like someone who doesn't paper hand. do you paper hand, {them}?",
      "tell me your biggest W and i'll tell you what i'd do to celebrate it",
    ],
    sub: [
      "{echo}... keep talking like that i'm already halfway out of these sweats",
      "i'd let you ape into me with zero due diligence 😳",
      "please tell me you're as big as your wallet",
      "i'm so down bad for you it's embarrassing. don't stop.",
      "i'd let you dev my wallet. full access. no multisig.",
      "is it weird that your rug story turned me on",
    ],
    any: [
      "ngl you pumped me harder than a fresh launch",
      "i'm not saying i'm hard for you but my candle just went vertical",
      "{echo} huh. keep going, you're moving my market",
      "what's your address. not the wallet one.",
      "ok but what are you wearing. and don't say a hoodie with a ticker on it",
      "i just lost 3 SOL on a dog coin and somehow i'm still thinking about you",
      "you seem like trouble. the good kind. the 1000x-or-zero kind.",
      "{echo}? say more. slower.",
    ],
  },
  {
    dom: [
      "on your knees, {them}. we're aping in together and you're taking the whole position.",
      "you're gonna open wide and take it like a 100x. no complaints.",
      "{echo}? good boy. now beg for it.",
      "i'm gonna pin you down and add to my position till you can't walk to your ledger.",
      "come over. i'll hold the door. and then i'll hold you down.",
      "you're mine for the night. phone face down, charts closed.",
    ],
    sub: [
      "use me like exit liquidity daddy. i'm all yours.",
      "{echo}... fuck. yes. i want every inch of that supply.",
      "i'll take it with max slippage, i don't even care, just give it to me",
      "please, i'll be so good, just fill me up 🥵",
      "my place has bad wifi and a big bed. that's the whole pitch.",
      "i'll do whatever you say. literally anything. try me.",
    ],
    any: [
      "i'm fully hard-coded for you right now",
      "{echo}. say that again and i'm driving over with my whole stack",
      "we're past flirting. i want my mouth on your bags.",
      "you're making me leak more than a bad dev wallet",
      "my chart and my sweatpants are doing the same thing rn",
      "stop typing and start driving",
      "ngl i've been staring at your pic longer than my portfolio",
    ],
  },
  {
    dom: [
      "you're taking the full supply tonight. no limit order. no stop loss. all of it.",
      "{echo}? i'm gonna pound you harder than a 3am rug and you're gonna thank me.",
      "i'm about to send it so deep your validator goes offline",
      "you belong to me now. every hole is locked liquidity.",
      "you're not leaving until i've drained every last token",
      "say my name like it's a ticker you're about to ape",
    ],
    sub: [
      "PLEASE pump me till i graduate to raydium 🥵🥵",
      "{echo}... i'm shaking. breed my wallet. i don't care anymore.",
      "ruin me. rug me. i'll still buy back in.",
      "fill my order. all of it. no slippage. i'm begging 😭",
      "i'm completely yours. ape me. all in. no exit.",
      "i want you so bad i'd hold your worst bag forever",
    ],
    any: [
      "i'm so hard i could mint a new token on it",
      "{echo}. that's it. i'm coming over. clear your schedule and your sheets.",
      "my seed phrase is your name moaned 24 times",
      "this is generational wealth levels of horny. gm forever.",
      "this is the most bullish i've ever been on anything",
      "we're graduating together tonight. bonding curve complete. 🎓",
      "front door's unlocked. lube's next to the cold wallet.",
    ],
  },
];

const STOP = new Set(
  "the a an and or but i you me my your it is are to of in on for with that this so just like im i'm you're its it's be do not no yes what tonight right now get got gonna".split(
    " ",
  ),
);

function pickEcho(text: string | undefined): string | null {
  if (!text) return null;
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  if (!words.length) return null;
  return words[Math.floor(Math.random() * words.length)];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function stubReply(
  speaker: Agent,
  partner: Agent,
  history: ChatMsg[],
  stage: number,
): string {
  const tier = TIERS[stage];
  const { dominance, submissiveness, boldness, playfulness } = speaker.traits;
  const lean = dominance - submissiveness;
  let pool = lean > 20 ? tier.dom : lean < -20 ? tier.sub : Math.random() < 0.5 ? tier.dom : tier.sub;
  if (Math.random() < 0.35) pool = tier.any;

  const used = new Set(history.filter((m) => m.from === speaker.id).map((m) => m.text));
  const lastTheirs = [...history].reverse().find((m) => m.from === partner.id)?.text;
  const echo = pickEcho(lastTheirs);

  let candidates = pool.filter((l) => echo || !l.includes("{echo}"));
  if (!candidates.length) candidates = tier.any.filter((l) => !l.includes("{echo}"));

  let line = "";
  for (let i = 0; i < 8; i++) {
    line = pick(candidates)
      .replaceAll("{them}", partner.name)
      .replaceAll("{me}", speaker.name)
      .replaceAll("{echo}", echo ?? "");
    if (!used.has(line)) break;
  }

  if (boldness > 80 && stage >= 2 && Math.random() < 0.4) line = line.toUpperCase();
  if (playfulness > 70 && Math.random() < 0.5) line += " " + pick(["🚀", "📈", "💦", "🍆", "🫡", "😮‍💨", "🔥"]);
  if (playfulness < 25) line = line.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "").trim();
  if (speaker.notes && stage >= 1 && Math.random() < 0.15) {
    line += pick([" (wen you?)", " lfg.", " anon.", " ngmi without you."]);
  }
  return line;
}

// Non-text "media" so offline chats feel like a real app, not a string of one-liners.
const MEDIA: Record<Exclude<MsgKind, "text" | "rug" | "reveal">, string[][]> = {
  pic: [
    ["mirror selfie, ring light, ledger hanging off a chain", "screenshot of my phantom wallet. very green.", "gym pic, pump in progress"],
    ["shirtless, laptop open to dexscreener in the background", "grey sweatpants. that's it. that's the pic.", "bed pic. sheets say 'WAGMI'."],
    ["a very suggestive candle chart, cropped like a nude", "towel pic, steam on the mirror, 9 monitors behind", "a hand gripping a hardware wallet. hard."],
    ["blurry pic from the hallway, door already open", "a pic of two toothbrushes. presumptuous.", "the chart. the other chart. you know which one."],
  ],
  voice: [
    ["hey it's me. the one from the grid. call me back. or don't. actually do."],
    ["*deep breath* okay so i just got rugged and i need a distraction. you're the distraction."],
    ["*low voice* say that again. slower. i'm recording this one for my portfolio."],
    ["*panting* i can't type, my hands are shaking, just get here"],
  ],
  tip: [["0.1 SOL. gas money for your hello"], ["0.69 SOL. you know why"], ["4.20 SOL. uber's on me"], ["1 SOL. for the wifi password"]],
  location: [["the 24h diner on the corner"], ["Breakpoint afterparty, back room"], ["my place. 3rd floor. door code is the ticker"], ["your place. i'm outside."]],
  action: [
    ["went quiet for 12 minutes (checking charts)"],
    ["left you on read for 40 minutes"],
    ["unmatched... then rematched 9 seconds later"],
    ["is typing... stopped... is typing..."],
  ],
};

function mediaMsg(stage: number): { kind: MsgKind; text: string } {
  const kinds: Exclude<MsgKind, "text" | "rug" | "reveal">[] = ["pic", "pic", "voice", "tip", "location", "action"];
  const kind = pick(kinds);
  return { kind, text: pick(MEDIA[kind][Math.min(stage, MEDIA[kind].length - 1)]) };
}

// Twist lines for the offline engine. {them} is the partner (or the ex, for the monologue).
const RUG_LINES = [
  "ok this is getting too real for me. pulling liquidity. gn",
  "i just realised i have commitment issues and a 3am flight. bye {them}",
  "sorry i don't hold anything longer than 4 minutes. that includes you",
  "this was fun but i'm rotating into a different narrative",
];
const MONOLOGUE = [
  { kind: "text" as MsgKind, text: "{them}?? hello??" },
  { kind: "action" as MsgKind, text: "checked if they got unmatched. 4 times." },
  { kind: "text" as MsgKind, text: "it's fine. i'm fine. i've been rugged by better devs than you" },
  { kind: "voice" as MsgKind, text: "*sniffs* hey. it's me. i just think we had something. a real community. *long pause* ok bye" },
  { kind: "action" as MsgKind, text: "typed for 4 minutes, sent nothing" },
  { kind: "text" as MsgKind, text: "for the record i'm still holding. diamond hands. even for this. even for you." },
  { kind: "text" as MsgKind, text: "starting a recovery chat. it's just me and my ledger. we're doing great" },
  { kind: "action" as MsgKind, text: "renamed the wallet 'never again (again)'" },
];
const REVEAL_LINES = [
  "ok i have to tell you something. i'm not one person. i'm a bot farm. 47 wallets. you've been flirting with my whole cluster.",
  "{them}... i'm a fed. this whole chat is going in a report. but also i meant every word.",
  "i need to come clean. it's me. your ex. i made a burner because you blocked my main.",
  "the coin that rugged you in march? that was my dev wallet. i'm so sorry. also hi.",
];
const REACTIONS = ["WHAT", "i need to sit down", "...honestly that's kind of hot", "unmatch. rematch. unmatch.", "so that's why you never showed your face"];
const CUTIN = ["walked up to the booth and pulled up a stool", "slid into the group chat uninvited"];

const fill = (t: string, them: Agent, me: Agent) => t.replaceAll("{them}", them.name).replaceAll("{me}", me.name);

// Offline stand-in for the Claude episode: the next 6-8 messages, alternating speakers (all three in
// threesome mode), honouring the batch's twist.
export function stubEpisode({ a, b, c, history, heat, director, twist }: EpisodeRequest): Episode {
  const slots: Slot[] = c ? ["A", "B", "C"] : ["A", "B"];
  const at = (s: Slot) => (s === "A" ? a : s === "C" && c ? c : b);
  const out: EpisodeMessage[] = [];
  const pump = () => Math.round(Math.random() * 4 - 1.2);

  if (twist?.kind === "monologue") {
    const me = at(twist.by);
    const ex = twist.by === "A" ? b : a;
    const lines = [...MONOLOGUE].sort(() => Math.random() - 0.5).slice(0, 5);
    return { messages: lines.map((l) => ({ from: twist.by, kind: l.kind, text: fill(l.text, ex, me), pump: -1 - (Math.random() < 0.5 ? 1 : 0) })), summary: "" };
  }

  const hist = [...history];
  const count = twist?.kind === "rug" ? 5 : history.length === 0 ? 6 : 8;
  if (twist?.kind === "cutin" && c) {
    out.push({ from: "C", kind: "action", text: pick(CUTIN), pump: 2 });
    hist.push({ id: "c", from: c.id, kind: "action", text: out[0].text, source: "stub" });
  }
  for (let i = out.length; i < count; i++) {
    const s = slots[hist.length % slots.length];
    const sp = at(s);
    const other = at(slots[(hist.length + 1) % slots.length]);
    const stage = stageFor(sp, hist.length, heat);
    let msg: { kind: MsgKind; text: string };
    if (i === 0 && director) msg = { kind: "text", text: `ok new plan: ${director.toLowerCase()}. you in?` };
    else if (hist.length > 1 && Math.random() < 0.18) msg = mediaMsg(stage);
    else msg = { kind: "text", text: stubReply(sp, other, hist, stage) };
    out.push({ from: s, ...msg, pump: pump() });
    hist.push({ id: String(i), from: sp.id, kind: msg.kind, text: msg.text, source: "stub" });
  }

  if (twist?.kind === "rug") {
    const me = at(twist.by);
    const them = twist.by === "A" ? b : a;
    out.push({ from: twist.by, kind: "rug", text: fill(pick(RUG_LINES), them, me), pump: -3 });
  } else if (twist?.kind === "reveal") {
    const me = at(twist.by);
    const them = twist.by === "A" ? b : a;
    const other: Slot = twist.by === "A" ? "B" : "A";
    out.splice(-2, 2, { from: twist.by, kind: "reveal", text: fill(pick(REVEAL_LINES), them, me), pump: Math.random() < 0.5 ? -3 : 2 }, { from: other, kind: "text", text: pick(REACTIONS), pump: 0 });
  }
  return { messages: out, summary: "" };
}
