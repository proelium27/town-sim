export const MIN_PER_HOUR = 60;
export const MIN_PER_DAY = 24 * 60;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ------------------------------------------------------------------ needs

export type NeedKey = 'energy' | 'hunger' | 'hygiene' | 'social' | 'fun' | 'work' | 'warmth';

export interface NeedDef {
  label: string;
  /** CSS color for meters (a --n-* token). */
  color: string;
  /** Mood line shown when the need runs low ("Hungry"). */
  low: string;
  /** Mood points lost per point below 30. */
  weight: number;
  /** Only shown while it matters (Warmth outside the cold months). */
  seasonal?: boolean;
  /** Starting value for people in saves made before this need existed (default 80). */
  backfill?: number;
}

/** Every need, in display order. UI and mood read from here, so adding a need is one entry. */
export const NEEDS: Record<NeedKey, NeedDef> = {
  energy: { label: 'Energy', color: 'var(--n-energy)', low: 'Exhausted', weight: 0.4 },
  hunger: { label: 'Hunger', color: 'var(--n-hunger)', low: 'Hungry', weight: 0.45 },
  hygiene: { label: 'Hygiene', color: 'var(--n-hygiene)', low: 'Grimy', weight: 0.3 },
  social: { label: 'Social', color: 'var(--n-social)', low: 'Lonely', weight: 0.3 },
  fun: { label: 'Fun', color: 'var(--n-fun)', low: 'Bored', weight: 0.3 },
  work: { label: 'Productivity', color: 'var(--n-work)', low: 'Unproductive', weight: 0.15 },
  warmth: { label: 'Warmth', color: 'var(--n-warmth)', low: 'Freezing', weight: 0.45, seasonal: true },
};
export const NEED_KEYS = Object.keys(NEEDS) as NeedKey[];
export const NEED_LABEL = Object.fromEntries(NEED_KEYS.map((k) => [k, NEEDS[k].label])) as Record<NeedKey, string>;

// ------------------------------------------------------------------ calendar

/** A season lasts two days and a year eight. Ages run on their own, faster clock (YEARS_PER_DAY). */
export const SEASON_DAYS = 2;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export type Season = (typeof SEASONS)[number];
export const YEAR_DAYS = SEASON_DAYS * SEASONS.length;

// ------------------------------------------------------------------ goods

export type Good = 'food' | 'wood' | 'stone' | 'firewood' | 'planks' | 'bricks' | 'furniture' | 'tools';

export interface GoodDef {
  label: string;
  /** One unit, for counts: "1 plank". Goods counted as a mass ("1 food") leave it out. */
  one?: string;
  /** CSS color for store bars. */
  color: string;
  /** Store bar fills at this amount. */
  cap: number;
  /** Shown in the top bar. */
  hud: boolean;
}

/** Everything the town stores, carries and builds with, in display order. */
export const GOODS: Record<Good, GoodDef> = {
  food: { label: 'Food', color: 'var(--n-hunger)', cap: 300, hud: true },
  wood: { label: 'Wood', color: 'oklch(0.55 0.09 60)', cap: 200, hud: true },
  stone: { label: 'Stone', color: 'oklch(0.6 0.01 80)', cap: 200, hud: true },
  firewood: { label: 'Firewood', color: 'oklch(0.66 0.13 45)', cap: 150, hud: true },
  planks: { label: 'Planks', one: 'plank', color: 'oklch(0.74 0.1 70)', cap: 80, hud: false },
  bricks: { label: 'Bricks', one: 'brick', color: 'oklch(0.6 0.13 35)', cap: 60, hud: false },
  furniture: { label: 'Furniture', color: 'oklch(0.62 0.09 55)', cap: 10, hud: false },
  tools: { label: 'Tools', one: 'tool', color: 'oklch(0.7 0.03 240)', cap: 20, hud: false },
};
export const GOOD_KEYS = Object.keys(GOODS) as Good[];

/** A count with its noun in the right form: "1 person", "3 people", "2 trees". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** How a good reads after a count of it: "1 plank", "40 planks", "1 food". */
export const goodNoun = (n: number, g: Good): string => (n === 1 && GOODS[g].one) || GOODS[g].label.toLowerCase();
export type Stock = Record<Good, number>;
/** A list of goods and amounts: a building's materials, a delivery so far. */
export type Bill = Partial<Record<Good, number>>;
export const emptyStock = (): Stock => Object.fromEntries(GOOD_KEYS.map((k) => [k, 0])) as Stock;
export const billGoods = (b: Bill): Good[] => GOOD_KEYS.filter((g) => (b[g] ?? 0) > 0);
/** "wood 12/40 · stone 0/20" */
export const billText = (need: Bill, have: Bill): string =>
  billGoods(need).map((g) => `${GOODS[g].label.toLowerCase()} ${Math.floor(Math.min(have[g] ?? 0, need[g]!))}/${need[g]}`).join(' · ');

// ------------------------------------------------------------------ skills

export type SkillKey = 'craft' | 'cooking' | 'charisma' | 'athletics' | 'music';
export const SKILL_KEYS: SkillKey[] = ['craft', 'cooking', 'charisma', 'athletics', 'music'];
export const SKILL_LABEL: Record<SkillKey, string> = {
  craft: 'Craft',
  cooking: 'Cooking',
  charisma: 'Charisma',
  athletics: 'Athletics',
  music: 'Music',
};

// ------------------------------------------------------------------ roles

export type RoleKey =
  | 'engineer' | 'designer' | 'writer' | 'manager' | 'receptionist' | 'barista' | 'shopkeeper' | 'librarian'
  | 'builder' | 'farmer' | 'woodcutter' | 'laborer' | 'teacher' | 'cook' | 'child' | 'retired'
  | 'carpenter' | 'mason' | 'toolmaker';

export interface RoleDef {
  key: RoleKey;
  title: string;
  /** What "Craft" means for this role, shown in the inspector. */
  craft: string;
  /** Fixed workplaces are hand-built; 'building' roles work wherever their assigned building is. */
  workplace: 'office' | 'cafe' | 'market' | 'library' | 'building' | 'outdoors' | 'none';
  /** desk/reception/counter: a seat with task progress; labor: outdoor work picked by labor.ts. */
  station: 'desk' | 'reception' | 'counter' | 'labor' | 'none';
  tasks: string[];
  /** Roles the town can reassign people between as its needs change. */
  flexible?: boolean;
}

export const ROLES: Record<RoleKey, RoleDef> = {
  engineer: {
    key: 'engineer', title: 'Software Engineer', craft: 'Engineering', workplace: 'office', station: 'desk',
    tasks: ['Fix the login timeout bug', 'Migrate the billing service', 'Write tests for search', 'Speed up the dashboard', 'Review a pull request', 'Patch the flaky deploy', 'Refactor the auth module', 'Add CSV export'],
  },
  designer: {
    key: 'designer', title: 'Product Designer', craft: 'Design', workplace: 'office', station: 'desk',
    tasks: ['Redesign onboarding', 'Draw icons for settings', 'Run a usability test', 'Polish the empty states', 'Mock up the mobile nav', 'Update the style guide'],
  },
  writer: {
    key: 'writer', title: 'Content Writer', craft: 'Writing', workplace: 'office', station: 'desk',
    tasks: ['Draft the release notes', 'Edit the help center', 'Write the newsletter', 'Interview a customer', 'Rewrite error messages'],
  },
  manager: {
    key: 'manager', title: 'Team Lead', craft: 'Management', workplace: 'office', station: 'desk',
    tasks: ['Plan next sprint', 'Write performance reviews', 'Prepare the roadmap', 'Hiring interviews', 'Budget review'],
  },
  receptionist: {
    key: 'receptionist', title: 'Office Manager', craft: 'Operations', workplace: 'office', station: 'reception',
    tasks: ['Sort the mail', 'Book the offsite', 'Order supplies', 'Greet visitors', 'Update the seating chart'],
  },
  barista: {
    key: 'barista', title: 'Barista', craft: 'Coffee', workplace: 'cafe', station: 'counter',
    tasks: ['Morning rush', 'Pull espresso shots', 'Bake croissants', 'Clean the machine', 'Afternoon orders'],
  },
  shopkeeper: {
    key: 'shopkeeper', title: 'Shopkeeper', craft: 'Retail', workplace: 'market', station: 'counter',
    tasks: ['Restock produce', 'Count the till', 'Unload a delivery', 'Price new stock'],
  },
  librarian: {
    key: 'librarian', title: 'Librarian', craft: 'Cataloguing', workplace: 'library', station: 'counter',
    tasks: ['Shelve returns', 'Catalogue donations', 'Run story hour', 'Repair old books'],
  },
  builder: { key: 'builder', title: 'Builder', craft: 'Building', workplace: 'outdoors', station: 'labor', tasks: [], flexible: true },
  farmer: { key: 'farmer', title: 'Farmer', craft: 'Farming', workplace: 'outdoors', station: 'labor', tasks: [], flexible: true },
  woodcutter: { key: 'woodcutter', title: 'Woodcutter', craft: 'Forestry', workplace: 'outdoors', station: 'labor', tasks: [], flexible: true },
  laborer: { key: 'laborer', title: 'Laborer', craft: 'Labor', workplace: 'outdoors', station: 'labor', tasks: [], flexible: true },
  carpenter: { key: 'carpenter', title: 'Carpenter', craft: 'Carpentry', workplace: 'outdoors', station: 'labor', tasks: [], flexible: true },
  mason: { key: 'mason', title: 'Mason', craft: 'Masonry', workplace: 'outdoors', station: 'labor', tasks: [], flexible: true },
  toolmaker: { key: 'toolmaker', title: 'Toolmaker', craft: 'Toolmaking', workplace: 'outdoors', station: 'labor', tasks: [], flexible: true },
  teacher: { key: 'teacher', title: 'Teacher', craft: 'Teaching', workplace: 'building', station: 'counter', tasks: ['Morning lessons', 'Grade homework', 'Reading circle', 'Science hour'], flexible: true },
  cook: { key: 'cook', title: 'Diner Cook', craft: 'Cooking', workplace: 'building', station: 'counter', tasks: ['Breakfast service', 'Lunch rush', 'Prep the soup', 'Dinner service'], flexible: true },
  child: { key: 'child', title: 'Child', craft: 'Learning', workplace: 'none', station: 'none', tasks: [] },
  retired: { key: 'retired', title: 'Retired', craft: 'Wisdom', workplace: 'none', station: 'none', tasks: [] },
};

/** Two years pass per game day, so children grow up in nine days and generations turn over in weeks. */
export const YEARS_PER_DAY = 2;
export const ADULT_AGE = 18;
export const RETIRE_AGE = 66;

// ------------------------------------------------------------------ town priorities (player)

export type PriorityKey = 'housing' | 'food' | 'materials' | 'community';
export const PRIORITY_KEYS: PriorityKey[] = ['housing', 'food', 'materials', 'community'];
export const PRIORITY_LABEL: Record<PriorityKey, string> = {
  housing: 'Housing',
  food: 'Food',
  materials: 'Wood & stone',
  community: 'Community',
};
/** Low / Normal / High multipliers. */
export const PRIORITY_WEIGHT = [0.4, 1, 1.9];
/** The most of the flexible workforce a lever can put into its own trade, at Low / Normal / High. */
export const PRIORITY_SHARE = [0.3, 0.5, 0.7];

// ------------------------------------------------------------------ traits

export type TraitKey =
  | 'introvert' | 'extrovert' | 'workaholic' | 'slacker' | 'foodie' | 'neatFreak'
  | 'earlyBird' | 'nightOwl' | 'cheerful' | 'grumpy' | 'competitive' | 'creative';

export interface TraitDef {
  name: string;
  description: string;
  conflicts: TraitKey[];
}

export const TRAITS: Record<TraitKey, TraitDef> = {
  introvert: { name: 'Introvert', description: 'Recharges alone. Social need fades slowly; crowds drain energy.', conflicts: ['extrovert'] },
  extrovert: { name: 'Extrovert', description: 'Needs people. Social need drops fast and chats give more.', conflicts: ['introvert'] },
  workaholic: { name: 'Workaholic', description: 'Productivity is everything. Works late, gets restless on breaks.', conflicts: ['slacker'] },
  slacker: { name: 'Slacker', description: 'Takes long breaks and works slower, but rarely burns out.', conflicts: ['workaholic'] },
  foodie: { name: 'Foodie', description: 'Gets hungry sooner and loves the café.', conflicts: [] },
  neatFreak: { name: 'Neat Freak', description: 'Hygiene matters twice as much to their mood.', conflicts: [] },
  earlyBird: { name: 'Early Bird', description: 'Up at dawn, fading by evening.', conflicts: ['nightOwl'] },
  nightOwl: { name: 'Night Owl', description: 'Sleeps in and stays up late.', conflicts: ['earlyBird'] },
  cheerful: { name: 'Cheerful', description: 'Baseline mood +8. Easy to get along with.', conflicts: ['grumpy'] },
  grumpy: { name: 'Grumpy', description: 'Baseline mood -8. Arguments come easily.', conflicts: ['cheerful'] },
  competitive: { name: 'Competitive', description: 'Loves ping pong. Losing stings; winning is everything.', conflicts: [] },
  creative: { name: 'Creative', description: 'Gets fun from music and books, and an occasional spark at work.', conflicts: [] },
};
export const TRAIT_KEYS = Object.keys(TRAITS) as TraitKey[];

// ------------------------------------------------------------------ memories

export type MemoryKind =
  | 'goodChat' | 'argument' | 'sharedMeal' | 'ateAlone' | 'greatCoffee' | 'noCoffee'
  | 'finishedTask' | 'praised' | 'missedDeadline' | 'pizza' | 'party' | 'wonPingPong' | 'lostPingPong'
  | 'soaked' | 'sleptWell' | 'badNight' | 'stinky' | 'starving' | 'longDay' | 'newFriend' | 'newRival'
  | 'meeting' | 'skillUp' | 'playedMusic' | 'goodRead' | 'commuteScare'
  | 'newPartner' | 'newBaby' | 'grief' | 'movedIn' | 'builtSomething' | 'townGrowing' | 'sleptRough' | 'proposed'
  | 'grewUp' | 'harvest' | 'school' | 'festival' | 'drought' | 'storm'
  | 'birthday' | 'myBirthday' | 'familyDinner' | 'paidRespects' | 'eveningWalk'
  | 'snowDay' | 'cozyFire' | 'coldHome' | 'blizzard' | 'madeSomething' | 'toolBroke' | 'unpaid' | 'broke' | 'qualified';

export interface MemoryDef {
  label: string;
  mood: number;
  /** Game minutes. */
  duration: number;
  major: boolean;
  maxStack: number;
}

const H = 60;
const D = 24 * H;

export const MEMORIES: Record<MemoryKind, MemoryDef> = {
  goodChat: { label: 'Nice chat', mood: 3, duration: 6 * H, major: false, maxStack: 3 },
  argument: { label: 'Argued', mood: -6, duration: 12 * H, major: false, maxStack: 3 },
  sharedMeal: { label: 'Shared a meal', mood: 4, duration: 6 * H, major: false, maxStack: 1 },
  ateAlone: { label: 'Ate alone', mood: -1, duration: 4 * H, major: false, maxStack: 1 },
  greatCoffee: { label: 'Great coffee', mood: 3, duration: 4 * H, major: false, maxStack: 1 },
  noCoffee: { label: 'The coffee machine is broken', mood: -4, duration: 6 * H, major: false, maxStack: 1 },
  finishedTask: { label: 'Finished a task', mood: 6, duration: 12 * H, major: true, maxStack: 2 },
  praised: { label: 'Got praised at standup', mood: 8, duration: D, major: true, maxStack: 1 },
  missedDeadline: { label: 'Missed a deadline', mood: -10, duration: D, major: true, maxStack: 1 },
  pizza: { label: 'Free pizza at the office', mood: 7, duration: 12 * H, major: true, maxStack: 1 },
  party: { label: 'Went to the party', mood: 12, duration: 1.5 * D, major: true, maxStack: 1 },
  wonPingPong: { label: 'Won at ping pong', mood: 6, duration: 8 * H, major: false, maxStack: 2 },
  lostPingPong: { label: 'Lost at ping pong', mood: -2, duration: 6 * H, major: false, maxStack: 2 },
  soaked: { label: 'Got caught in the rain', mood: -4, duration: 4 * H, major: false, maxStack: 1 },
  sleptWell: { label: 'Slept well', mood: 4, duration: 12 * H, major: false, maxStack: 1 },
  badNight: { label: 'Barely slept', mood: -6, duration: 12 * H, major: false, maxStack: 1 },
  stinky: { label: 'Feeling grimy', mood: -5, duration: 3 * H, major: false, maxStack: 1 },
  starving: { label: 'Starving', mood: -10, duration: 2 * H, major: true, maxStack: 1 },
  longDay: { label: 'Long day at work', mood: -4, duration: 10 * H, major: false, maxStack: 1 },
  newFriend: { label: 'Made a friend', mood: 6, duration: 2 * D, major: true, maxStack: 2 },
  newRival: { label: 'Someone really gets on my nerves', mood: -5, duration: 2 * D, major: true, maxStack: 2 },
  meeting: { label: 'Sat through a meeting', mood: -1, duration: 4 * H, major: false, maxStack: 1 },
  skillUp: { label: 'Getting better at something', mood: 4, duration: D, major: false, maxStack: 2 },
  playedMusic: { label: 'Played the piano', mood: 4, duration: 8 * H, major: false, maxStack: 1 },
  goodRead: { label: 'Got lost in a good book', mood: 3, duration: 8 * H, major: false, maxStack: 1 },
  commuteScare: { label: 'Nearly got hit by a car', mood: -6, duration: 8 * H, major: true, maxStack: 1 },
  newPartner: { label: 'Fell in love', mood: 14, duration: 3 * D, major: true, maxStack: 1 },
  newBaby: { label: 'A new baby in the family', mood: 15, duration: 3 * D, major: true, maxStack: 2 },
  grief: { label: 'Lost someone close', mood: -18, duration: 3 * D, major: true, maxStack: 2 },
  movedIn: { label: 'Moved into a new home', mood: 10, duration: 2 * D, major: true, maxStack: 1 },
  builtSomething: { label: 'Helped build something', mood: 6, duration: D, major: true, maxStack: 2 },
  townGrowing: { label: 'The town is growing', mood: 3, duration: D, major: false, maxStack: 1 },
  sleptRough: { label: 'Had nowhere to sleep', mood: -10, duration: D, major: true, maxStack: 1 },
  proposed: { label: 'My idea was picked at the town meeting', mood: 5, duration: D, major: true, maxStack: 1 },
  grewUp: { label: 'All grown up', mood: 8, duration: 2 * D, major: true, maxStack: 1 },
  harvest: { label: 'Brought in a good harvest', mood: 4, duration: 12 * H, major: false, maxStack: 1 },
  school: { label: 'Learned something at school', mood: 3, duration: 12 * H, major: false, maxStack: 1 },
  festival: { label: 'Danced at the town festival', mood: 12, duration: 2 * D, major: true, maxStack: 1 },
  drought: { label: 'Worried about the drought', mood: -6, duration: D, major: true, maxStack: 1 },
  storm: { label: 'Rode out a storm', mood: -4, duration: D, major: true, maxStack: 1 },
  birthday: { label: 'Celebrated a birthday', mood: 6, duration: 12 * H, major: false, maxStack: 2 },
  myBirthday: { label: 'My birthday party', mood: 12, duration: 1.5 * D, major: true, maxStack: 1 },
  familyDinner: { label: 'Dinner with the family', mood: 6, duration: 10 * H, major: false, maxStack: 1 },
  paidRespects: { label: 'Visited a grave', mood: 3, duration: 2 * D, major: false, maxStack: 2 },
  eveningWalk: { label: 'Evening walk together', mood: 5, duration: D, major: false, maxStack: 1 },
  snowDay: { label: 'First snow!', mood: 8, duration: D, major: true, maxStack: 1 },
  cozyFire: { label: 'Warm by the fire', mood: 4, duration: 8 * H, major: false, maxStack: 1 },
  coldHome: { label: 'No firewood at home', mood: -8, duration: 8 * H, major: true, maxStack: 1 },
  blizzard: { label: 'Snowed in by a blizzard', mood: -3, duration: D, major: true, maxStack: 1 },
  madeSomething: { label: 'Made something good', mood: 4, duration: 8 * H, major: false, maxStack: 1 },
  toolBroke: { label: 'My tools broke', mood: -2, duration: 4 * H, major: false, maxStack: 1 },
  unpaid: { label: 'The town could not pay me', mood: -5, duration: D, major: true, maxStack: 1 },
  broke: { label: "Can't afford groceries", mood: -7, duration: D, major: true, maxStack: 1 },
  qualified: { label: 'Finished my apprenticeship', mood: 8, duration: 1.5 * D, major: true, maxStack: 1 },
};
