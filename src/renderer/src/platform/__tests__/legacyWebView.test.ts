import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('legacy Android WebView runtime', () => {
  it('boots supported APIs in a fresh runtime that lacks modern array/object/string built-ins', () => {
    const modules = ['array/at', 'array/find-last', 'array/find-last-index', 'array/to-sorted', 'object/has-own', 'string/replace-all', 'url/can-parse']
      .map((name) => require.resolve(`core-js/actual/${name}`))
    const script = `
      for (const name of ['at','findLast','findLastIndex','toSorted']) delete Array.prototype[name];
      delete Object.hasOwn; delete String.prototype.replaceAll; delete URL.canParse;
      ${modules.map((module) => `require(${JSON.stringify(module)});`).join('\n')}
      const source = [3,1,2];
      if (source.at(-1) !== 2 || source.findLast(x => x < 3) !== 2 || source.findLastIndex(x => x === 1) !== 1) throw new Error('Array APIs unavailable');
      if (JSON.stringify(source.toSorted()) !== '[1,2,3]' || source[0] !== 3) throw new Error('Sort mutates source');
      if (!Object.hasOwn({ chapter: 1 }, 'chapter') || Object.hasOwn({}, 'toString')) throw new Error('Own-property check incorrect');
      if ('chapters/main'.replaceAll('/', '-') !== 'chapters-main') throw new Error('Path API unavailable');
      if (!URL.canParse('https://example.com') || URL.canParse('invalid-url')) throw new Error('URL API unavailable');
      console.log('legacy-runtime-ok');
    `
    expect(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim()).toBe('legacy-runtime-ok')
  })
})
