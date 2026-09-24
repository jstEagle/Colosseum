import { Box, Text } from 'ink';
import { rule } from '../ascii.js';
import { theme } from '../theme.js';
import { readLedger, LEDGER, VERSION } from '../results.js';
import { standings } from '../ratings.js';

const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);

interface Props {
  rows: number;
  cols: number;
}

/** The hall of champions: every match on record, as standings. */
export function Leaderboard({ rows, cols }: Props) {
  // Rules change between versions; compare like with like.
  const ledger = readLedger().filter((m) => m.version === VERSION);
  const { rows: table, excluded } = standings(ledger);
  const width = Math.min(cols - 4, 96);
  const nameW = Math.max(12, Math.min(40, width - 56));
  const shown = table.slice(0, Math.max(1, rows - 12));
  const cell = (s: string, w: number, right = true) => {
    const t = s.length > w ? s.slice(0, w - 1) + '…' : s;
    return right ? t.padStart(w) : t.padEnd(w);
  };

  return (
    <Box flexDirection="column" alignItems="center" width={cols} height={rows}>
      <Text color={theme.white} bold>
        {'H A L L   O F   C H A M P I O N S'}
      </Text>
      <Text color={theme.charcoal}>{rule(width, '✦')}</Text>
      {table.length === 0 ? (
        <Box marginTop={2}>
          <Text color={theme.muted}>{'No matches on record yet. Fight one, or run `colosseum bench`.'}</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.dim}>
            {cell('', 4, false) + cell('GLADIATOR', nameW, false) + cell('RATING', 8) + cell('W-L-D', 10) + cell('KILL', 8) + cell('TRIALS', 9) + cell('HUNT', 8) + cell('WRONG', 7)}
          </Text>
          {shown.map((r, i) => (
            <Text key={r.key} color={i === 0 ? theme.white : i < 3 ? theme.bright : theme.muted} bold={i === 0}>
              {cell(r.rating === null ? '·' : String(i + 1), 4, false) +
                cell(r.name, nameW, false) +
                cell(r.rating === null ? '—' : r.rating.toFixed(0), 8) +
                cell(r.duels ? `${r.wins}-${r.losses}-${r.draws}` : '—', 10) +
                cell(secs(r.killMs), 8) +
                cell(r.trials ? `${r.trialKills}/${r.trials}` : '—', 9) +
                cell(secs(r.trialKillMs), 8) +
                cell(r.matches ? (r.wrongBlows / r.matches).toFixed(1) : '—', 7)}
            </Text>
          ))}
        </Box>
      )}
      <Box flexGrow={1} />
      <Text color={theme.charcoal}>
        {`${ledger.length} matches under v${VERSION} rules in ${LEDGER}${excluded ? ` · ${excluded} left out (void or errored)` : ''}`}
      </Text>
      <Text color={theme.dim}>{'RATING Bradley–Terry, duels only · TRIALS kills against the dummy · WRONG decoy blows per match'}</Text>
      <Text color={theme.dim}>{'esc  back   ·   q  leave'}</Text>
    </Box>
  );
}
