import { describe, it, expect } from 'vitest';
import { parseContracts, splitEvenly } from './contracts';

describe('parseContracts (the list Aram pastes from Upwork)', () => {
  it('reads freelancer names with the contract link embedded (pasted from a web page)', () => {
    const html = `<ul><li><a href="https://www.upwork.com/ab/c/111">Ana Pop</a></li>
      <li><a href="https://www.upwork.com/ab/c/222"><span>Bo Li</span></a></li>
      <li>no link here</li><li><a href="javascript:alert(1)">Bad</a></li></ul>`;
    expect(parseContracts(html, '')).toEqual([
      { label: 'Ana Pop', url: 'https://www.upwork.com/ab/c/111' },
      { label: 'Bo Li', url: 'https://www.upwork.com/ab/c/222' },
    ]);
  });
  it('also reads plain lines with a name and a link, or a bare link', () => {
    expect(parseContracts('', 'Ana Pop https://www.upwork.com/ab/c/111\nBo Li\thttps://www.upwork.com/ab/c/222\n\nhttps://www.upwork.com/ab/c/333\njunk')).toEqual([
      { label: 'Ana Pop', url: 'https://www.upwork.com/ab/c/111' },
      { label: 'Bo Li', url: 'https://www.upwork.com/ab/c/222' },
      { label: 'https://www.upwork.com/ab/c/333', url: 'https://www.upwork.com/ab/c/333' },
    ]);
  });
  it('drops duplicate links', () => {
    expect(parseContracts('', 'A https://x.test/1\nB https://x.test/1')).toEqual([{ label: 'A', url: 'https://x.test/1' }]);
  });
});

describe('splitEvenly', () => {
  it('splits in order into parts that differ by at most one', () => {
    expect(splitEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8], [9, 10]]);
    expect(splitEvenly([1, 2], 4)).toEqual([[1], [2], [], []]);
    expect(splitEvenly([], 3)).toEqual([[], [], []]);
  });
});

describe('parseContracts details', () => {
  it('decodes entities in names and links', () => {
    expect(parseContracts(`<a href="https://x.test/c?a=1&amp;b=2">Jos&eacute; &amp; Ana</a>`, '')).toEqual([{ label: 'Jos&eacute; & Ana', url: 'https://x.test/c?a=1&b=2' }]);
  });
});
