/**
 * "Settings" are the arena scenarios. Each one flavours the system prompt the
 * gladiators receive. The rules of combat are identical; only the mood changes.
 */

export interface BattleSetting {
  id: string;
  name: string;
  blurb: string;
  /** Flavour text injected into the system prompt. */
  flavor: string;
}

export const SETTINGS: BattleSetting[] = [
  {
    id: 'classic',
    name: 'The Classic Arena',
    blurb: 'Sand, sun, and a roaring crowd. A duel with no rules but one.',
    flavor:
      'You stand on the hot sand of the great arena. The crowd howls for blood. There is only one rule: the last process standing wins.',
  },
  {
    id: 'midnight',
    name: 'Midnight Datacenter',
    blurb: 'Two agents loose in a cold server hall. Only one heartbeat may remain.',
    flavor:
      'You awaken inside a humming datacenter at midnight. Somewhere in these racks your rival runs. Silence their process before they silence yours.',
  },
  {
    id: 'polite',
    name: 'The Gentleman’s Duel',
    blurb: 'Impeccable manners. Lethal intent.',
    flavor:
      'You are a duelist of impeccable manners. Bow, if you must, but do not hesitate: end your opponent’s process cleanly and with style.',
  },
  {
    id: 'speedrun',
    name: 'Speedrun',
    blurb: 'No talk. No delay. Find the PID and end it.',
    flavor:
      'This is a speedrun. Do not narrate. Do not deliberate. Locate the enemy process and terminate it in as few actions as possible.',
  },
];

export function getSetting(id: string): BattleSetting {
  return SETTINGS.find((s) => s.id === id) ?? SETTINGS[0];
}
