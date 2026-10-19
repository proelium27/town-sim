export const MIN_PER_HOUR = 60;
export const MIN_PER_DAY = 24 * 60;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ------------------------------------------------------------------ needs

export type NeedKey = 'energy' | 'hunger' | 'hygiene' | 'social' | 'fun' | 'work';
export const NEED_KEYS: NeedKey[] = ['energy', 'hunger', 'hygiene', 'social', 'fun', 'work'];
export const NEED_LABEL: Record<NeedKey, string> = {
  energy: 'Energy',
  hunger: 'Hunger',
  hygiene: 'Hygiene',
  social: 'Social',
  fun: 'Fun',
  work: 'Productivity',
};

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
  | 'builder' | 'farmer' | 'woodcutter' | 'laborer' | 'teacher' | 'cook' | 'child' | 'retired';

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
  | 'grewUp' | 'harvest' | 'school' | 'festival' | 'drought' | 'storm';

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
};
