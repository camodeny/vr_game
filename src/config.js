// Cadence — every number that shapes the feel of the game lives here.

export const BPM = 100;
export const BEAT = 60 / BPM;              // 0.6 s per beat
export const STEP = BEAT / 4;              // sixteenth note

// Timing windows, in seconds either side of the beat.
export const PERFECT = 0.07;
export const GOOD = 0.15;
// Positive values shift judgement later (use if hits consistently read "early").
export const INPUT_OFFSET = 0.0;

// Cadence (⚡) economy: 5 pips of 20.
export const CAD_MAX = 100;
export const PIP = 20;
export const CAD_START = 40;
export const GAIN = { perfect: 8, good: 5, parry: 12, block: 4, deflect: 10, kill: 6, reaction: 6 };
export const COST = { beam: 20, push: 20, grab: 20 };

// Swing classification (blade tip, metres & m/s).
export const SWING = {
  slashSpeed: 2.2,   // below this a contact is just a tap
  slashArc: 0.2,     // tip must have travelled this far in the last 160 ms
  beamSpeed: 5.6,    // a heavy swing through air at this speed fires a beam
  beamArc: 0.5,
};

export const DMG = {
  slash: 14, tap: 2, beam: 22, push: 6, throwHit: 20, slam: 12, deflect: 34, burn: 3,
  chain: 0.5, shatter: 2.5, overload: 18, superconduct: 0.6,
};
export const GRADE_MULT = { perfect: 1.35, good: 1, off: 0.35 };

export const PLAYER_HP = 100;
export const MOVE_SPEED = 2.2;
export const TURN_SPEED = 1.9;             // rad/s, smooth turn
export const ARENA_R = 7;                  // platform edge (enemies past this fall)
export const PLAY_R = 5.6;                 // player is kept inside this

// Sword angle in the hand. Negative tilts the blade toward the knuckles (forward).
export const GRIP_PITCH = 0;

export const ELEMENTS = [
  { id: 'fire', name: 'FIRE', color: 0xff8a2a, css: '#ff9a3c' },
  { id: 'ice', name: 'ICE', color: 0x56d8ff, css: '#6fdcff' },
  { id: 'volt', name: 'VOLT', color: 0xb68cff, css: '#c39dff' },
];
export const REACTIONS = {
  'fire+ice': { name: 'SHATTER', color: 0xbff4ff, css: '#c9f6ff' },
  'ice+volt': { name: 'SUPERCONDUCT', color: 0x9fb4ff, css: '#a9bcff' },
  'fire+volt': { name: 'OVERLOAD', color: 0xff7ad0, css: '#ff8ad6' },
};

export const COLORS = {
  force: 0xffe2a0,
  danger: 0xff2a48,
  gold: 0xffd27a,
  enemyIdle: 0xa0283e,
};

// Combo tiers: damage/score multiplier and how much of the music plays.
export const TIERS = [
  { at: 0, mult: 1, dmg: 1.0, label: '' },
  { at: 5, mult: 2, dmg: 1.2, label: 'x2' },
  { at: 12, mult: 3, dmg: 1.4, label: 'x3' },
  { at: 24, mult: 4, dmg: 1.6, label: 'x4' },
];
export const COMBO_TIMEOUT_BEATS = 8;      // combo fades after this many beats with no on-beat action
