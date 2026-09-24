import { test } from 'node:test';
import assert from 'node:assert/strict';
// test/ sits outside tsconfig's include, so JSX here is the classic kind.
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { Picture, fitPicture } from '../src/components/Picture.js';

test('a picture keeps its grey escapes and fits the space it is given', () => {
  const pic = fitPicture('gaul', 40, 10)!;
  assert.ok(pic.cols <= 40 && pic.rows <= 10);
  const { lastFrame, unmount } = render(<Picture name="gaul" maxCols={40} maxRows={10} />);
  const frame = lastFrame()!;
  assert.match(frame, /\x1b\[38;5;2(3[2-9]|4\d|5[0-5])m/);
  const lines = stripAnsi(frame).split('\n');
  assert.equal(lines.length, pic.rows);
  assert.ok(lines.every((l) => l.length <= pic.cols));
  unmount();
});

test('no rendering at all when nothing fits', () => {
  assert.equal(fitPicture('colosseum', 20, 5), null);
});
