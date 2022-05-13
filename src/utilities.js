/**
 * Generates array of numbers
 * @param {number} end
 * @param {number=} start
 * @param {number=} step
 * @see https://www.30secondsofcode.org/articles/s/javascript-range-generator
 */
export function rangeGenerator(end, start = 0, step = 1) {
  function* generateRange() {
    let x = start - step;
    while (x <= end - step) yield (x += step);
  }
  return {
    [Symbol.iterator]: generateRange,
  };
}
